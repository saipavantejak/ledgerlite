import type { INestApplication } from '@nestjs/common';
import type { AccountDto } from '@ledgerlite/shared';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, entries, http, makeAccount, makeApp, makePool, postTx, resetDb } from './helpers';

describe('validation and database enforcement', () => {
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

  it('rejects unbalanced entries with 422 and persists nothing', async () => {
    const res = await postTx(app, 'k1', [
      { accountId: cash.id, direction: 'debit', amountCents: '1000' },
      { accountId: wallet.id, direction: 'credit', amountCents: '999' },
    ]);
    expect(res.status).toBe(422);
    expect(await count(pool, 'transactions')).toBe(0);
    expect(await count(pool, 'journal_entries')).toBe(0);
  });

  it('rejects zero and negative amounts', async () => {
    for (const amt of ['0', '-5', 0, -5]) {
      const res = await postTx(app, `k-${String(amt)}`, entries(cash, wallet, amt));
      expect(res.status).toBe(422);
    }
    expect(await count(pool, 'transactions')).toBe(0);
  });

  it('rejects fewer than two entries, non-integer amounts and unknown or malformed account ids', async () => {
    expect((await postTx(app, 'a', [{ accountId: cash.id, direction: 'debit', amountCents: '5' }])).status).toBe(422);
    expect((await postTx(app, 'b', entries(cash, wallet, '1.5'))).status).toBe(422);
    const ghost = { id: randomUUID() } as AccountDto;
    expect((await postTx(app, 'c', entries(cash, ghost))).status).toBe(422);
    const bad = { id: 'not-a-uuid' } as AccountDto;
    expect((await postTx(app, 'd', entries(cash, bad))).status).toBe(422);
    expect(await count(pool, 'transactions')).toBe(0);
  });

  it('rejects idempotency key reuse with a different body (409)', async () => {
    expect((await postTx(app, 'same', entries(cash, wallet, '1000'))).status).toBe(201);
    expect((await postTx(app, 'same', entries(cash, wallet, '2000'))).status).toBe(409);
    expect(await count(pool, 'transactions')).toBe(1);
  });

  it('serialises amounts as strings and keeps amounts above 2^53 exact', async () => {
    const big = '9007199254740993'; // 2^53 + 1: not representable as a JS number
    const res = await postTx(app, 'big', entries(cash, wallet, big));
    expect(res.status).toBe(201);
    expect(res.body.entries.every((e: { amountCents: unknown }) => typeof e.amountCents === 'string')).toBe(true);
    expect(res.body.entries[0].amountCents).toBe(big);
    const bal = await http(app).get(`/accounts/${cash.id}/balance`);
    expect(bal.body.balanceCents).toBe(big);
    // A number this large cannot be trusted on the wire and is refused.
    expect((await postTx(app, 'big-num', entries(cash, wallet, 9007199254740993))).status).toBe(422);
  });

  it('database rejects UPDATE and DELETE on entries and transactions', async () => {
    await postTx(app, 'imm', entries(cash, wallet));
    await expect(pool.query(`UPDATE journal_entries SET memo = 'x'`)).rejects.toThrow(/ledger is immutable/);
    await expect(pool.query(`DELETE FROM journal_entries`)).rejects.toThrow(/ledger is immutable/);
    await expect(pool.query(`UPDATE transactions SET description = 'x'`)).rejects.toThrow(/ledger is immutable/);
    await expect(pool.query(`DELETE FROM transactions`)).rejects.toThrow(/ledger is immutable/);
    expect(await count(pool, 'journal_entries')).toBe(2);
  });

  it('database rejects an unbalanced or single-entry transaction at commit, bypassing the API', async () => {
    const attempt = async (rows: [string, number][]) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const t = await c.query(`INSERT INTO transactions (idempotency_key, request_hash, description) VALUES ($1, 'h', 'raw') RETURNING id`, [randomUUID()]);
        for (const [dir, amt] of rows) {
          await c.query(`INSERT INTO journal_entries (transaction_id, account_id, direction, amount_cents) VALUES ($1, $2, $3, $4)`, [t.rows[0].id, cash.id, dir, amt]);
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    };
    await expect(attempt([['debit', 100], ['credit', 99]])).rejects.toThrow(/out of balance/);
    await expect(attempt([['debit', 100]])).rejects.toThrow(/at least 2 entries/);
    expect(await count(pool, 'transactions')).toBe(0);
    await expect(attempt([['debit', 100], ['credit', 100]])).resolves.toBeUndefined();
  });

  it('reverses by posting flipped entries linked via reference; original untouched; second reversal is 409', async () => {
    const orig = await postTx(app, 'orig', entries(cash, wallet, '1234'));
    const rev = await http(app).post(`/transactions/${orig.body.id}/reverse`).send({ idempotencyKey: 'rev1', reason: 'mistake' });
    expect(rev.status).toBe(201);
    expect(rev.body.reference).toBe(`reverses:${orig.body.id}`);
    const flipped = rev.body.entries.map((e: { accountId: string; direction: string; amountCents: string }) => `${e.accountId}:${e.direction}:${e.amountCents}`).sort();
    expect(flipped).toEqual([`${cash.id}:credit:1234`, `${wallet.id}:debit:1234`].sort());
    expect((await http(app).get(`/transactions/${orig.body.id}`)).body).toEqual(orig.body);
    expect((await http(app).get(`/accounts/${cash.id}/balance`)).body.balanceCents).toBe('0');
    const again = await http(app).post(`/transactions/${orig.body.id}/reverse`).send({ idempotencyKey: 'rev2', reason: 'again' });
    expect(again.status).toBe(409);
    expect((await http(app).post(`/transactions/${randomUUID()}/reverse`).send({ idempotencyKey: 'rev3', reason: 'x' })).status).toBe(404);
  });

  it('lists transactions newest-first with a working cursor and account filter', async () => {
    for (let i = 0; i < 5; i++) await postTx(app, `p${i}`, entries(cash, wallet, String(100 + i)));
    const p1 = await http(app).get('/transactions?limit=2');
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await http(app).get(`/transactions?limit=2&cursor=${p1.body.nextCursor}`);
    const p3 = await http(app).get(`/transactions?limit=2&cursor=${p2.body.nextCursor}`);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
    expect((await http(app).get(`/transactions?accountId=${cash.id}`)).body.items).toHaveLength(5);
    expect((await http(app).get('/transactions?limit=0')).status).toBe(422);
  });

  it('enforces the dev API key when API_KEY is set, except on /health', async () => {
    process.env.API_KEY = 'secret';
    try {
      expect((await http(app).get('/accounts')).status).toBe(401);
      expect((await http(app).get('/accounts').set('x-api-key', 'secret')).status).toBe(200);
      expect((await http(app).get('/health')).status).toBe(200);
    } finally {
      process.env.API_KEY = '';
    }
  });
});
