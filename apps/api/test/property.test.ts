import type { INestApplication } from '@nestjs/common';
import type { AccountDto } from '@ledgerlite/shared';
import fc from 'fast-check';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, makeAccount, makeApp, makePool, postTx, resetDb } from './helpers';

const N_ACCOUNTS = 4;
const side = fc.array(fc.record({ acct: fc.integer({ min: 0, max: N_ACCOUNTS - 1 }), amt: fc.integer({ min: 1, max: 1_000_000 }) }), { minLength: 1, maxLength: 3 });
const txArb = fc.record({ debits: side, credits: side, fixAcct: fc.integer({ min: 0, max: N_ACCOUNTS - 1 }) });

type Side = { acct: number; amt: number }[];
type TxSpec = { debits: Side; credits: Side; fixAcct: number };
type Leg = { acct: number; direction: 'debit' | 'credit'; amt: bigint };

/** Turns two arbitrary sides into a balanced set of legs by topping up the lighter side. */
function balanced(t: TxSpec): Leg[] {
  const legs: Leg[] = [
    ...t.debits.map((d) => ({ acct: d.acct, direction: 'debit' as const, amt: BigInt(d.amt) })),
    ...t.credits.map((c) => ({ acct: c.acct, direction: 'credit' as const, amt: BigInt(c.amt) })),
  ];
  const sum = (dir: string) => legs.filter((l) => l.direction === dir).reduce((s, l) => s + l.amt, 0n);
  const diff = sum('debit') - sum('credit');
  if (diff > 0n) legs.push({ acct: t.fixAcct, direction: 'credit', amt: diff });
  if (diff < 0n) legs.push({ acct: t.fixAcct, direction: 'debit', amt: -diff });
  return legs;
}

describe('property: random sequences of balanced transactions', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    app = await makeApp();
    pool = makePool();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('keeps the ledger balanced and derived balances equal to recomputed sums', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(txArb, { minLength: 1, maxLength: 8 }), async (seq) => {
        await resetDb(pool);
        const accounts: AccountDto[] = [];
        for (let i = 0; i < N_ACCOUNTS; i++) accounts.push(await makeAccount(app, `A${i}`, i % 2 ? 'liability' : 'asset'));
        const model = new Map<string, bigint>(accounts.map((a) => [a.id, 0n]));

        for (const [i, t] of seq.entries()) {
          const legs = balanced(t);
          const res = await postTx(
            app,
            `seq-${i}`,
            legs.map((l) => ({ accountId: accounts[l.acct]!.id, direction: l.direction, amountCents: l.amt.toString() })),
          );
          expect(res.status).toBe(201);
          for (const l of legs) {
            const id = accounts[l.acct]!.id;
            model.set(id, model.get(id)! + (l.direction === 'debit' ? l.amt : -l.amt));
          }
        }

        // 1. global signed sum is zero
        const g = await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END),0)::text AS net FROM journal_entries`);
        expect(g.rows[0].net).toBe('0');
        // 2. every transaction balances
        const bad = await pool.query(
          `SELECT transaction_id FROM journal_entries GROUP BY transaction_id
           HAVING SUM(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END) <> 0 OR COUNT(*) < 2`,
        );
        expect(bad.rowCount).toBe(0);
        // 3. derived balances (API view) == recomputed from raw entries == independent in-memory model
        const api = (await http(app).get('/accounts')).body as AccountDto[];
        for (const a of accounts) {
          const raw = await pool.query(
            `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END),0)::text AS s FROM journal_entries WHERE account_id = $1`,
            [a.id],
          );
          const derived = api.find((x) => x.id === a.id)!.signedBalanceCents;
          expect(derived).toBe(raw.rows[0].s);
          expect(BigInt(derived)).toBe(model.get(a.id));
        }
        // 4. the reconciliation job agrees
        const run = await http(app).post('/reconciliation/run');
        expect(run.body.status).toBe('ok');
      }),
      { numRuns: 20 },
    );
  });
});
