import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

export type Schema = typeof schema

export type Database = NodePgDatabase<Schema>

/** A database handle or an open transaction — services accept either. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export interface DatabaseHandle {
  db: Database
  pool: pg.Pool
}

export function createDatabase(url: string, max = 10): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: url, max })

  return { db: drizzle(pool, { schema }), pool }
}

export { schema }
