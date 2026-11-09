/**
 * Local database maintenance for the docker compose Postgres:
 *
 * - `pnpm db:reset`  drops every schema (app, auth, workflow runtime), re-runs the
 *                    migrations and the workflow bootstrap: an empty instance (/setup).
 * - `pnpm db:demo`   reset, then generate the demo data (scripts/seed.ts).
 *
 * Runs under tsx outside Nuxt; only touches the compose database on localhost.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_FILE = resolve(APP_DIR, '../../docker-compose.yml')

/** Schemas owned by the app (drizzle), the auth tables and the Workflow SDK Postgres world. */
const SCHEMAS = ['public', 'drizzle', 'workflow', 'workflow_drizzle', 'graphile_worker'] as const

const LOCAL_HOSTS: ReadonlySet<string> = new Set<string>(['localhost', '127.0.0.1', '::1'])

interface DatabaseTarget {
  user: string
  database: string
}

/** Runs a command to completion with inherited output. */
class CommandRunner {
  run(command: string, args: readonly string[]): Promise<void> {
    return new Promise((ok, fail) => {
      const child = spawn(command, args, { cwd: APP_DIR, stdio: 'inherit' })

      child.on('error', fail)
      child.on('close', (code) =>
        code === 0 ? ok() : fail(new Error(`${command} ${args[0] ?? ''} exited with code ${code}`))
      )
    })
  }
}

/** Runs SQL through psql inside the compose `postgres` service. */
class ComposePostgres {
  constructor(
    private readonly target: DatabaseTarget,
    private readonly runner: CommandRunner
  ) {}

  static fromEnvironment(runner: CommandRunner): ComposePostgres {
    const raw = process.env.NUXT_DATABASE_URL

    if (!raw) throw new Error('NUXT_DATABASE_URL is not set (apps/web/.env).')

    const url = new URL(raw)

    if (!LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(`Refusing to touch a non-local database (${url.hostname}).`)
    }

    return new ComposePostgres(
      { user: decodeURIComponent(url.username), database: url.pathname.slice(1) },
      runner
    )
  }

  sql(statement: string): Promise<void> {
    return this.runner.run('docker', [
      'compose',
      '-f',
      COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      this.target.user,
      '-d',
      this.target.database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-c',
      statement
    ])
  }
}

class DatabaseMaintenance {
  constructor(
    private readonly postgres: ComposePostgres,
    private readonly runner: CommandRunner
  ) {}

  async reset(): Promise<void> {
    console.log('Dropping schemas…')
    const drops = SCHEMAS.map((schema) => `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`).join(' ')

    await this.postgres.sql(`${drops} CREATE SCHEMA public;`)

    console.log('Running migrations…')
    await this.runner.run('pnpm', ['run', '--silent', 'db:setup'])
    console.log('Database reset: open the app and create the first admin at /setup.')
  }

  async demo(): Promise<void> {
    await this.reset()
    console.log('Generating demo data…')
    await this.runner.run('pnpm', ['run', '--silent', 'seed'])
  }
}

const COMMANDS = ['reset', 'demo'] as const

type Command = (typeof COMMANDS)[number]

const isCommand = (value: string | undefined): value is Command =>
  COMMANDS.some((command) => command === value)

async function main(argument: string | undefined): Promise<void> {
  if (!isCommand(argument)) throw new Error(`Usage: tsx scripts/db.ts <${COMMANDS.join('|')}>`)

  process.loadEnvFile(resolve(APP_DIR, '.env'))
  const runner = new CommandRunner()
  const maintenance = new DatabaseMaintenance(ComposePostgres.fromEnvironment(runner), runner)

  if (argument === 'reset') await maintenance.reset()
  else await maintenance.demo()
}

try {
  await main(process.argv[2])
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
