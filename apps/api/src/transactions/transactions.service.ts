import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Direction, EntryDto, TransactionDto, TransactionPage } from '@ledgerlite/shared';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { requestHash } from '../common/canonical';
import { isUniqueViolation, iso } from '../common/sql';
import { asObject, cents, invalid, optStr, str, uuid, UUID_RE } from '../common/validate';

/** Idempotency keys are scoped per endpoint by storing "<scope>|<client key>". */
const SCOPE_POST = 'post';
const SCOPE_REVERSE = 'reverse';
const KEY_CONSTRAINT = 'transactions_idempotency_key_key';

interface KeyRow {
  id: string;
  request_hash: string;
}
type Outcome = { id: string } | { existing: KeyRow };
export interface Result {
  status: 200 | 201;
  body: TransactionDto;
}

interface ParsedEntry {
  accountId: string;
  direction: Direction;
  amount: bigint;
}

export function parseCreateBody(body: unknown): {
  key: string;
  description: string;
  reference: string | null;
  entries: ParsedEntry[];
} {
  const b = asObject(body);
  const key = str(b.idempotencyKey, 'idempotencyKey', 200);
  const description = str(b.description, 'description');
  const reference = optStr(b.reference, 'reference');
  if (!Array.isArray(b.entries) || b.entries.length < 2) invalid('entries must contain at least 2 items');
  if (b.entries.length > 100) invalid('entries must contain at most 100 items');
  let debits = 0n;
  let credits = 0n;
  const entries = b.entries.map((raw: unknown, i: number): ParsedEntry => {
    const e = asObject(raw, `entries[${i}]`);
    const direction = e.direction;
    if (direction !== 'debit' && direction !== 'credit') invalid(`entries[${i}].direction must be 'debit' or 'credit'`);
    const amount = cents(e.amountCents, `entries[${i}].amountCents`);
    if (direction === 'debit') debits += amount;
    else credits += amount;
    return { accountId: uuid(e.accountId, `entries[${i}].accountId`), direction, amount };
  });
  if (debits !== credits) invalid(`transaction out of balance: debits ${debits} != credits ${credits}`);
  return { key, description, reference, entries };
}

@Injectable()
export class TransactionsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async post(body: unknown): Promise<Result> {
    const { key, description, reference, entries } = parseCreateBody(body);
    const hash = requestHash({
      description,
      reference,
      entries: entries.map((e) => ({ accountId: e.accountId, direction: e.direction, amountCents: e.amount.toString() })),
    });
    return this.run(`${SCOPE_POST}|${key}`, hash, async (c) => {
      const ids = [...new Set(entries.map((e) => e.accountId))];
      const found = await c.query('SELECT id FROM accounts WHERE id = ANY($1::uuid[])', [ids]);
      if (found.rowCount !== ids.length) invalid('one or more accounts do not exist');
      const id = await this.insertTransaction(c, `${SCOPE_POST}|${key}`, hash, description, reference);
      await c.query(
        `INSERT INTO journal_entries (transaction_id, account_id, direction, amount_cents)
         SELECT $1, a, d, m FROM unnest($2::uuid[], $3::text[], $4::bigint[]) AS t(a, d, m)`,
        [id, entries.map((e) => e.accountId), entries.map((e) => e.direction), entries.map((e) => e.amount.toString())],
      );
      return { id };
    });
  }

  async reverse(originalId: string, body: unknown): Promise<Result> {
    const original = uuid(originalId, 'id');
    const b = asObject(body);
    const key = str(b.idempotencyKey, 'idempotencyKey', 200);
    const reason = str(b.reason, 'reason');
    const hash = requestHash({ transactionId: original, reason });
    const scoped = `${SCOPE_REVERSE}|${key}`;
    return this.run(scoped, hash, async (c) => {
      // Serialises concurrent reversals of the same transaction.
      const lock = await c.query('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', [original]);
      if (!lock.rows[0]) throw new NotFoundException('transaction not found');
      // Re-check the key under the lock: a parallel retry of this same request may have just committed.
      const again = await this.findByKey(c, scoped);
      if (again) return { existing: again };
      const already = await c.query('SELECT 1 FROM transactions WHERE reference = $1 LIMIT 1', [`reverses:${original}`]);
      if (already.rowCount) throw new ConflictException('transaction has already been reversed');
      const id = await this.insertTransaction(c, scoped, hash, `Reversal of ${original}: ${reason}`, `reverses:${original}`);
      await c.query(
        `INSERT INTO journal_entries (transaction_id, account_id, direction, amount_cents, memo)
         SELECT $1, account_id, CASE WHEN direction = 'debit' THEN 'credit' ELSE 'debit' END, amount_cents, $3
         FROM journal_entries WHERE transaction_id = $2`,
        [id, original, `Reversal: ${reason}`],
      );
      return { id };
    });
  }

  async get(id: string): Promise<TransactionDto> {
    const [tx] = await this.load([uuid(id, 'id')]);
    if (!tx) throw new NotFoundException('transaction not found');
    return tx;
  }

  async list(q: Record<string, string | undefined>): Promise<TransactionPage> {
    const accountId = q.accountId ? uuid(q.accountId, 'accountId') : null;
    let limit = 50;
    if (q.limit !== undefined) {
      limit = Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) invalid('limit must be an integer between 1 and 200');
    }
    let curTs: string | null = null;
    let curId: string | null = null;
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
      if (!ts || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(ts))) throw new BadRequestException('invalid cursor');
      curTs = ts;
      curId = id;
    }
    const r = await this.pool.query<{ id: string; created_at: string }>(
      `SELECT t.id, ${iso('t.created_at')} AS created_at FROM transactions t
       WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM journal_entries e WHERE e.transaction_id = t.id AND e.account_id = $1))
         AND ($2::timestamptz IS NULL OR (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
       ORDER BY t.created_at DESC, t.id DESC LIMIT $4`,
      [accountId, curTs, curId, limit + 1],
    );
    const page = r.rows.slice(0, limit);
    const last = page[page.length - 1];
    const items = await this.load(page.map((p) => p.id));
    return {
      items,
      nextCursor:
        r.rows.length > limit && last ? Buffer.from(`${last.created_at}|${last.id}`).toString('base64url') : null,
    };
  }

  // ---- internals -------------------------------------------------------------------------------

  /**
   * One DB transaction per write. Retried/parallel requests with the same key resolve to the stored result;
   * the same key with a different body is a 409. The balance trigger is deferred, so it fires at COMMIT.
   * The pooled connection is always released before any follow-up read: holding it while asking the pool
   * for a second one deadlocks once enough requests are in flight.
   */
  private async run(scopedKey: string, hash: string, work: (c: PoolClient) => Promise<Outcome>): Promise<Result> {
    let outcome: Outcome;
    try {
      outcome = await this.inTransaction(scopedKey, work);
    } catch (err) {
      if (!isUniqueViolation(err, KEY_CONSTRAINT)) throw this.mapDbError(err);
      const existing = await this.findByKey(this.pool, scopedKey);
      if (!existing) throw this.mapDbError(err);
      outcome = { existing };
    }
    if ('existing' in outcome) return this.replay(outcome.existing, hash);
    return { status: 201, body: await this.get(outcome.id) };
  }

  private async inTransaction(scopedKey: string, work: (c: PoolClient) => Promise<Outcome>): Promise<Outcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.findByKey(client, scopedKey);
      const outcome: Outcome = existing ? { existing } : await work(client);
      await client.query('existing' in outcome ? 'ROLLBACK' : 'COMMIT');
      return outcome;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async replay(existing: KeyRow, hash: string): Promise<Result> {
    if (existing.request_hash !== hash) throw new ConflictException('idempotency key was already used with a different request body');
    return { status: 200, body: await this.get(existing.id) };
  }

  private async findByKey(db: Pool | PoolClient, scopedKey: string): Promise<KeyRow | undefined> {
    const r = await db.query<KeyRow>('SELECT id, request_hash FROM transactions WHERE idempotency_key = $1', [scopedKey]);
    return r.rows[0];
  }

  private async insertTransaction(c: PoolClient, key: string, hash: string, description: string, reference: string | null): Promise<string> {
    const r = await c.query<{ id: string }>(
      'INSERT INTO transactions (idempotency_key, request_hash, description, reference) VALUES ($1, $2, $3, $4) RETURNING id',
      [key, hash, description, reference],
    );
    return r.rows[0]!.id;
  }

  private mapDbError(err: unknown): unknown {
    const e = err as { code?: string; message?: string };
    // P0001 = RAISE EXCEPTION from the balance trigger; 23503 = FK violation.
    if (e?.code === 'P0001' || e?.code === '23503') return new UnprocessableEntityException(e.message);
    return err;
  }

  private async load(ids: string[]): Promise<TransactionDto[]> {
    if (ids.length === 0) return [];
    const txs = await this.pool.query<{ id: string; idempotency_key: string; description: string; reference: string | null; created_at: string }>(
      `SELECT id, idempotency_key, description, reference, ${iso('created_at')} AS created_at FROM transactions WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const entries = await this.pool.query<{ id: string; transaction_id: string; account_id: string; direction: Direction; amount: string; memo: string | null }>(
      `SELECT id, transaction_id, account_id, direction, amount_cents::text AS amount, memo
       FROM journal_entries WHERE transaction_id = ANY($1::uuid[]) ORDER BY transaction_id, direction DESC, id`,
      [ids],
    );
    const byTx = new Map<string, EntryDto[]>();
    for (const e of entries.rows) {
      const list = byTx.get(e.transaction_id) ?? [];
      list.push({ id: e.id, accountId: e.account_id, direction: e.direction, amountCents: e.amount, memo: e.memo });
      byTx.set(e.transaction_id, list);
    }
    const byId = new Map(txs.rows.map((t) => [t.id, t]));
    return ids.flatMap((id) => {
      const t = byId.get(id);
      if (!t) return [];
      const clientKey = t.idempotency_key.slice(t.idempotency_key.indexOf('|') + 1);
      return [{ id: t.id, idempotencyKey: clientKey, description: t.description, reference: t.reference, createdAt: t.created_at, entries: byTx.get(id) ?? [] }];
    });
  }
}
