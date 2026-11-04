import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-db';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    // One shared test database: files must not run concurrently.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      API_KEY: '',
    },
  },
});
