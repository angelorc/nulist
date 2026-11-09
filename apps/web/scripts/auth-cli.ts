// Only used by `pnpm auth:generate` to produce server/db/auth-schema.ts. Keep the
// schema-affecting plugin options in sync with server/auth.config.ts.
import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import { ac, roles } from '../shared/auth/permissions'

const db = drizzle(
  process.env.NUXT_DATABASE_URL ?? 'postgres://nulist:nulist@localhost:5442/nulist'
)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: 'uuid' } },
  plugins: [
    admin(),
    organization({ ac, roles }),
    apiKey({ enableMetadata: true, references: 'organization', rateLimit: { enabled: false } })
  ]
})
