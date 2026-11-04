import type { INestApplication } from '@nestjs/common';
import type { AccountDto } from '@ledgerlite/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, entries, http, makeAccount, makeApp, makePool, postTx, resetDb } from './helpers';

describe('idempotency', () => {
  let app: INestApplication;
  let pool: Pool;
  let cash: AccountDto;
  let wallet: AccountDto;

  beforeAll(async () => {
    app = await makeApp();
    pool = makePool();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await resetDb(pool);
    cash = await makeAccount(app, '1000', 'asset');
    wallet = await makeAccount(app, '2000', 'liability');
  });

  it('same key twice: 201 then 200 with an identical body, one transaction', async () => {
    const a = await postTx(app, 'k', entries(cash, wallet));
    const b = await postTx(app, 'k', entries(cash, wallet));
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body).toEqual(a.body);
    expect(await count(pool, 'transactions')).toBe(1);
    expect(await count(pool, 'journal_entries')).toBe(2);
  });

  it('same key 10 times in parallel: exactly one transaction, identical bodies', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => postTx(app, 'par', entries(cash, wallet, '777'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    for (const r of results) expect(r.body).toEqual(results[0]!.body);
    expect(await count(pool, 'transactions')).toBe(1);
    expect((await http(app).get(`/accounts/${cash.id}/balance`)).body.balanceCents).toBe('777');
  });

  it('is insensitive to JSON key order but not to content', async () => {
    const body = { description: 'd', entries: entries(cash, wallet), idempotencyKey: 'order' };
    const reordered = { idempotencyKey: 'order', entries: entries(cash, wallet).map((e) => ({ amountCents: e.amountCents, direction: e.direction, accountId: e.accountId })), description: 'd' };
    expect((await http(app).post('/transactions').send(body)).status).toBe(201);
    expect((await http(app).post('/transactions').send(reordered)).status).toBe(200);
    expect((await http(app).post('/transactions').send({ ...body, description: 'other' })).status).toBe(409);
  });

  it('reversal: same key 10 times in parallel creates exactly one reversing transaction', async () => {
    const orig = await postTx(app, 'orig', entries(cash, wallet, '500'));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => http(app).post(`/transactions/${orig.body.id}/reverse`).send({ idempotencyKey: 'rev', reason: 'oops' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    for (const r of results) expect(r.body).toEqual(results[0]!.body);
    expect(await count(pool, 'transactions')).toBe(2);
  });

  it('parallel reversals with different keys: one wins, the rest are 409', async () => {
    const orig = await postTx(app, 'orig2', entries(cash, wallet, '500'));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => http(app).post(`/transactions/${orig.body.id}/reverse`).send({ idempotencyKey: `r${i}`, reason: 'dup' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await count(pool, 'transactions')).toBe(2);
  });

  it('keys are scoped per endpoint: the same key string works for post and reverse', async () => {
    const orig = await postTx(app, 'shared-key', entries(cash, wallet));
    const rev = await http(app).post(`/transactions/${orig.body.id}/reverse`).send({ idempotencyKey: 'shared-key', reason: 'scoped' });
    expect(rev.status).toBe(201);
    expect(rev.body.id).not.toBe(orig.body.id);
  });
});
