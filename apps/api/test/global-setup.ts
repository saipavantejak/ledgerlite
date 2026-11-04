import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { TEST_DATABASE_URL } from './test-db';

/** Rebuilds the test schema from the real migrations. Refuses to touch any database not named *_test. */
export default async function setup(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`refusing to reset database "${dbName}": test database name must end in _test`);
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
