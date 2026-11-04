import type { INestApplication } from '@nestjs/common';
import type { AccountDto } from '@ledgerlite/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, entries, http, makeAccount, makeApp, makePool, postTx, resetDb } from './helpers';

describe('reconciliation', () => {
  let app: INestApplication;
  let pool: Pool;
  let cash: AccountDto;
  let wallet: AccountDto;

  beforeAll(async () => {
    app = await makeApp();
    pool = makePool();
  });
  afterAll(async () => {
    await pool.query('ALTER TABLE journal_entries ENABLE TRIGGER trg_transaction_balanced');
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await resetDb(pool);
    cash = await makeAccount(app, '1000', 'asset');
    wallet = await makeAccount(app, '2000', 'liability');
  });

  it('a clean ledger reconciles ok with all four checks passing', async () => {
    await postTx(app, 'r1', entries(cash, wallet, '4200'));
    const res = await http(app).post('/reconciliation/run');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.checks).sort()).toEqual(['globalSum', 'idempotencyKeysUnique', 'noOrphanEntries', 'transactionsBalanced']);
    expect(Object.values(res.body.checks).every((c) => (c as { ok: boolean }).ok)).toBe(true);
    expect(res.body.findings).toEqual([]);
    expect(res.body.finishedAt).toBeTruthy();
  });

  it('injected drift (balance trigger disabled, unbalanced row) is detected, recorded, and the run is marked drift', async () => {
    await postTx(app, 'r2', entries(cash, wallet, '1000'));
    // Test database only: bypass the commit-time trigger the way a bad migration or manual SQL could.
    await pool.query('ALTER TABLE journal_entries DISABLE TRIGGER trg_transaction_balanced');
    try {
      const t = await pool.query(`INSERT INTO transactions (idempotency_key, request_hash, description) VALUES ('drift', 'x', 'drift') RETURNING id`);
      await pool.query(`INSERT INTO journal_entries (transaction_id, account_id, direction, amount_cents) VALUES ($1, $2, 'debit', 500)`, [t.rows[0].id, cash.id]);
    } finally {
      await pool.query('ALTER TABLE journal_entries ENABLE TRIGGER trg_transaction_balanced');
    }
    const before = { tx: await count(pool, 'transactions'), entries: await count(pool, 'journal_entries') };

    const run = await http(app).post('/reconciliation/run');
    expect(run.body.status).toBe('drift');
    expect(run.body.checks.globalSum.ok).toBe(false);
    expect(run.body.checks.transactionsBalanced.ok).toBe(false);
    expect(run.body.checks.noOrphanEntries.ok).toBe(true);
    const names = run.body.findings.map((f: { checkName: string }) => f.checkName);
    expect(names).toContain('globalSum');
    expect(names).toContain('transactionsBalanced');
    expect(run.body.findings.find((f: { checkName: string }) => f.checkName === 'globalSum').detail).toMatch(/500/);

    const stored = await http(app).get(`/reconciliation/runs/${run.body.id}`);
    expect(stored.body.status).toBe('drift');
    expect(stored.body.findings.length).toBe(run.body.findings.length);
    const list = await http(app).get('/reconciliation/runs');
    expect(list.body[0].id).toBe(run.body.id);
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM reconciliation_findings WHERE run_id = $1', [run.body.id]);
    expect(rows.rows[0].n).toBe(run.body.findings.length);

    // The job reads the ledger; it never writes to it.
    expect({ tx: await count(pool, 'transactions'), entries: await count(pool, 'journal_entries') }).toEqual(before);
  });
});
