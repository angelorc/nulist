import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../server/db/migrations')

type MigrationStep = () => Promise<void>

class AppMigrator {
  private static readonly LOCK_KEY = 7_204_311_982

  constructor(
    private readonly connectionString: string,
    private readonly migrationsFolder: string
  ) {}

  static fromEnvironment(): AppMigrator {
    const url = process.env.NUXT_DATABASE_URL

    if (!url) throw new Error('NUXT_DATABASE_URL is not set.')

    return new AppMigrator(url, MIGRATIONS_DIR)
  }

  async run(next: MigrationStep): Promise<void> {
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()

    try {
      await client.query('SELECT pg_advisory_lock($1)', [AppMigrator.LOCK_KEY])
      await migrate(drizzle(client), { migrationsFolder: this.migrationsFolder })
      await next()
    } finally {
      await client.end()
    }
  }
}

try {
  console.log('Applying app migrations…')
  await AppMigrator.fromEnvironment().run(async () => {
    const { setupDatabase } = await import('@workflow/world-postgres/cli')
    await setupDatabase()
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
