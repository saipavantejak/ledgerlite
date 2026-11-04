import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { AccountDto, AccountType, TransactionDto } from '@ledgerlite/shared';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { TEST_DATABASE_URL } from './test-db';

export async function makeApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.listen(0, '127.0.0.1'); // listen once so supertest reuses one server instead of binding one per request
  return app;
}

export const makePool = (): Pool => new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
export const http = (app: INestApplication) => request(app.getHttpServer());

/** TRUNCATE does not fire row triggers, so it is the only way to wipe the immutable ledger between tests. */
export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE reconciliation_findings, reconciliation_runs, journal_entries, transactions, accounts RESTART IDENTITY CASCADE',
  );
}

export async function makeAccount(app: INestApplication, code: string, type: AccountType = 'asset'): Promise<AccountDto> {
  const res = await http(app).post('/accounts').send({ code, name: `Account ${code}`, type });
  if (res.status !== 201) throw new Error(`account create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as AccountDto;
}

export const entries = (debit: AccountDto, credit: AccountDto, amountCents: string | number = '1000') => [
  { accountId: debit.id, direction: 'debit', amountCents },
  { accountId: credit.id, direction: 'credit', amountCents },
];

export async function postTx(app: INestApplication, key: string, e: unknown[], description = 'test') {
  return http(app).post('/transactions').send({ idempotencyKey: key, description, entries: e });
}

export const count = async (pool: Pool, table: string): Promise<number> =>
  Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

export type Tx = TransactionDto;
