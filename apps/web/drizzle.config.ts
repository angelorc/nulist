import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  schemaFilter: ['public'],
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL ?? 'postgres://nulist:nulist@localhost:5442/nulist'
  }
})
