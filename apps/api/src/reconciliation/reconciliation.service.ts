import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ReconciliationCheck, ReconciliationFinding, ReconciliationRunDto } from '@ledgerlite/shared';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { iso } from '../common/sql';
import { uuid } from '../common/validate';

const SIGNED = `CASE WHEN e.direction = 'debit' THEN e.amount_cents ELSE -e.amount_cents END`;
const MAX_FINDINGS_PER_CHECK = 100;

interface Finding {
  check: string;
  detail: string;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'drift';
  checks: Record<string, ReconciliationCheck>;
}

@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scheduled(): Promise<void> {
    const run = await this.run();
    this.log.log(`reconciliation ${run.id}: ${run.status}`);
  }

  async run(): Promise<ReconciliationRunDto> {
    const started = await this.pool.query<{ id: string }>(`INSERT INTO reconciliation_runs (status) VALUES ('running') RETURNING id`);
    const runId = started.rows[0]!.id;
    let checks: Record<string, ReconciliationCheck>;
    let findings: Finding[];
    try {
      ({ checks, findings } = await this.runChecks());
    } catch (err) {
      const detail = `reconciliation job failed: ${(err as Error).message}`;
      checks = { jobError: { ok: false, detail } };
      findings = [{ check: 'jobError', detail }];
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of findings) {
        await client.query('INSERT INTO reconciliation_findings (run_id, check_name, detail) VALUES ($1, $2, $3)', [runId, f.check, f.detail]);
      }
      await client.query(`UPDATE reconciliation_runs SET status = $2, finished_at = now(), checks = $3::jsonb WHERE id = $1`, [
        runId,
        findings.length ? 'drift' : 'ok',
        JSON.stringify(checks),
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return this.getRun(runId);
  }

  async listRuns(): Promise<ReconciliationRunDto[]> {
    const r = await this.pool.query<RunRow>(`${this.runSelect()} ORDER BY started_at DESC LIMIT 20`);
    return r.rows.map((row) => this.toRun(row));
  }

  async getRun(id: string): Promise<ReconciliationRunDto> {
    const r = await this.pool.query<RunRow>(`${this.runSelect()} WHERE id = $1`, [uuid(id, 'id')]);
    if (!r.rows[0]) throw new NotFoundException('reconciliation run not found');
    const f = await this.pool.query<{ id: string; check_name: string; detail: string; found_at: string }>(
      `SELECT id, check_name, detail, ${iso('found_at')} AS found_at FROM reconciliation_findings WHERE run_id = $1 ORDER BY found_at, id`,
      [id],
    );
    const findings: ReconciliationFinding[] = f.rows.map((x) => ({ id: x.id, checkName: x.check_name, detail: x.detail, foundAt: x.found_at }));
    return { ...this.toRun(r.rows[0]), findings };
  }

  // ---- checks (read-only snapshot of the ledger) ---------------------------------------------------

  /** Runs inside a READ ONLY, REPEATABLE READ transaction: the job cannot write to the ledger and sees one consistent snapshot. */
  private async runChecks(): Promise<{ checks: Record<string, ReconciliationCheck>; findings: Finding[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const checks: Record<string, ReconciliationCheck> = {};
      const findings: Finding[] = [];
      const record = (name: string, bad: string[], okDetail: string) => {
        checks[name] = bad.length ? { ok: false, detail: `${bad.length} problem(s)` } : { ok: true, detail: okDetail };
        for (const d of bad.slice(0, MAX_FINDINGS_PER_CHECK)) findings.push({ check: name, detail: d });
      };
      record('globalSum', await this.globalSum(client), 'sum of all signed entries is 0');
      record('transactionsBalanced', await this.unbalanced(client), 'every transaction balances');
      record('noOrphanEntries', await this.orphans(client), 'no orphan entries');
      record('idempotencyKeysUnique', await this.duplicateKeys(client), 'idempotency keys are unique');
      return { checks, findings };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  private async globalSum(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ net: string }>(`SELECT COALESCE(SUM(${SIGNED}), 0)::text AS net FROM journal_entries e`);
    const net = r.rows[0]!.net;
    return net === '0' ? [] : [`global signed sum of entries is ${net} cents (expected 0)`];
  }

  private async unbalanced(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ id: string; net: string; n: number }>(
      `SELECT t.id, COALESCE(SUM(${SIGNED}), 0)::text AS net, COUNT(e.id)::int AS n
       FROM transactions t LEFT JOIN journal_entries e ON e.transaction_id = t.id
       GROUP BY t.id HAVING COALESCE(SUM(${SIGNED}), 0) <> 0 OR COUNT(e.id) < 2`,
    );
    return r.rows.map((x) => `transaction ${x.id}: net ${x.net} cents across ${x.n} entr${x.n === 1 ? 'y' : 'ies'}`);
  }

  private async orphans(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ id: string; missing: string }>(
      `SELECT e.id, 'transaction' AS missing FROM journal_entries e LEFT JOIN transactions t ON t.id = e.transaction_id WHERE t.id IS NULL
       UNION ALL
       SELECT e.id, 'account' FROM journal_entries e LEFT JOIN accounts a ON a.id = e.account_id WHERE a.id IS NULL`,
    );
    return r.rows.map((x) => `entry ${x.id} references a missing ${x.missing}`);
  }

  private async duplicateKeys(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ k: string; n: number }>(
      `SELECT idempotency_key AS k, COUNT(*)::int AS n FROM transactions GROUP BY idempotency_key HAVING COUNT(*) > 1`,
    );
    return r.rows.map((x) => `idempotency key ${x.k} used by ${x.n} transactions`);
  }

  private runSelect(): string {
    return `SELECT id, ${iso('started_at')} AS started_at, ${iso('finished_at')} AS finished_at, status, checks FROM reconciliation_runs`;
  }

  private toRun(r: RunRow): ReconciliationRunDto {
    return { id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, checks: r.checks };
  }
}
