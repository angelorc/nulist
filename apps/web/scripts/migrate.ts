import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../server/db/migrations')

class AppMigrator {
  constructor(
    private readonly connectionString: string,
    private readonly migrationsFolder: string
  ) {}

  static fromEnvironment(): AppMigrator {
    const url = process.env.NUXT_DATABASE_URL

    if (!url) throw new Error('NUXT_DATABASE_URL is not set.')

    return new AppMigrator(url, MIGRATIONS_DIR)
  }

  async run(): Promise<void> {
    const pool = new Pool({ connectionString: this.connectionString, max: 1 })

    try {
      await migrate(drizzle(pool), { migrationsFolder: this.migrationsFolder })
    } finally {
      await pool.end()
    }
  }
}

try {
  console.log('Applying app migrations…')
  await AppMigrator.fromEnvironment().run()
  const { setupDatabase } = await import('@workflow/world-postgres/cli')
  await setupDatabase()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
