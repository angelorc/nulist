import { defineConfig } from 'vitest/config'

/**
 * Functional test-suite: services run against a real Postgres database
 * (`mlist_test`, reset and migrated once by the global setup). Files share that
 * database, so they run one at a time in a single forked process.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/support/global-setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000
  }
})
