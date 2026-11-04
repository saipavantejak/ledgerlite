import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../src/seed/flows';
import { count, http, makeApp, makePool, resetDb } from './helpers';

describe('Yuzu-style demo flows (posted through the real HTTP API)', () => {
  let app: INestApplication;
  let pool: Pool;
  let url: string;

  beforeAll(async () => {
    app = await makeApp();
    pool = makePool();
    await resetDb(pool);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('five flows leave Cash 33450, Member Wallet 33450, Provider Payable 0, Card Clearing 0; re-seeding is a no-op', async () => {
    const first = await seedDemo(url);
    expect(first).toMatchObject({ Cash: '33450', 'Member Wallet': '33450', 'Provider Payable': '0', 'Card Clearing': '0', 'Employer Funding': '0', 'Fee Revenue': '0' });
    const second = await seedDemo(url);
    expect(second).toEqual(first);
    expect(await count(pool, 'transactions')).toBe(5);
    expect((await http(app).post('/reconciliation/run')).body.status).toBe('ok');
  });
});
