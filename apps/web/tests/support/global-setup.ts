import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../../server/db/client'
import { TEST_DATABASE_URL } from './database'

const MIGRATIONS = fileURLToPath(new URL('../../server/db/migrations', import.meta.url))

/** Rebuilds the test database from the real migrations once per `vitest run`. */
export async function setup(): Promise<void> {
  const { db, pool } = createDatabase(TEST_DATABASE_URL, 1)

  try {
    // `drizzle` holds the migrator's journal; dropping it makes every migration run again.
    await pool.query('drop schema if exists drizzle cascade')
    await pool.query('drop schema if exists public cascade')
    await pool.query('create schema public')
    await migrate(db, { migrationsFolder: MIGRATIONS })
  } finally {
    await pool.end()
  }
}
