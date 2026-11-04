import type { INestApplication } from '@nestjs/common';
import type { AccountDto } from '@ledgerlite/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, entries, http, makeAccount, makeApp, makePool, postTx, resetDb } from './helpers';

describe('concurrency', () => {
  let app: INestApplication;
  let pool: Pool;
  let cash: AccountDto;
  let wallet: AccountDto;

  beforeAll(async () => {
    app = await makeApp();
    pool = makePool();
    await resetDb(pool);
    cash = await makeAccount(app, '1000', 'asset');
    wallet = await makeAccount(app, '2000', 'liability');
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('100 parallel posts to one account: exact balance, no lost updates, no 500s', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => postTx(app, `c${i}`, entries(cash, wallet, String(i + 1)))));
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const expected = (100 * 101) / 2; // 1 + 2 + ... + 100
    expect((await http(app).get(`/accounts/${cash.id}/balance`)).body.signedBalanceCents).toBe(String(expected));
    expect((await http(app).get(`/accounts/${wallet.id}/balance`)).body.signedBalanceCents).toBe(String(-expected));
    expect(await count(pool, 'transactions')).toBe(100);
    expect(await count(pool, 'journal_entries')).toBe(200);
  });
});
