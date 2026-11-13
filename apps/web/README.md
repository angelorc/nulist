# @nulist/web

![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82)
![Postgres 18](https://img.shields.io/badge/Postgres-18-336791)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

The nulist application: dashboard, REST API, recipient-facing pages and background workers in a
single Nuxt 4 app. Everything — data, sessions and the durable workflow queue — lives in one
Postgres database.

## Features

- 🖥️ **Dashboard** — contacts, lists, segments, templates, broadcasts, transactional logs, files and analytics, built with Nuxt UI.
- 🔑 **Auth & tenancy** — Better Auth sessions, organizations with members and roles, invitations and scoped API keys.
- 📤 **Sending** — per-organization Amazon SES or SMTP providers, verified sending domains and a throttled send pipeline.
- 🌐 **REST API** — `/api/v1` for emails, contacts, lists, broadcasts and templates with idempotency and rate limits.
- 📨 **Recipient pages** — hosted subscribe forms, double opt-in confirmation, preference center, one-click unsubscribe and web view.
- 🔔 **Events** — SES feedback via SNS, open/click tracking, suppression handling and signed outbound webhooks.
- 🔁 **Durable workflows** — broadcasts, transactional sends, imports, opt-ins and webhook deliveries survive restarts.
- 🛡️ **Admin & audit** — instance admin panel with per-organization limits and a full audit log.

## Stack

| Concern        | Library                                                  |
| -------------- | -------------------------------------------------------- |
| Framework / UI | Nuxt 4, Nuxt UI 4, Tailwind CSS 4                        |
| Database       | Postgres 18, Drizzle ORM / drizzle-kit                   |
| Auth           | Better Auth via `@nuxtjs/better-auth` (+ API key plugin) |
| Background     | Workflow DevKit with the Postgres world                  |
| Email          | Amazon SES v2, Nodemailer (SMTP), MJML, LiquidJS         |
| Editor         | Templatical, CodeMirror                                  |
| Storage        | Any S3-compatible bucket                                 |
| Validation     | Zod 4, shared between client and server                  |

## Layout

```
app/       Pages, components and composables (see DESIGN.md for UI rules)
server/
  api/     Dashboard API, public recipient endpoints and the /api/v1 REST API
  lib/     Domain services (contacts, broadcasts, deliverability, email, storage, …)
  workflows/  Durable workflows and their steps
  db/      Drizzle schema
shared/    Zod schemas and types used by both sides
scripts/   Seed, reset and demo data
tests/     Functional tests against a real database
```

## Development

From the repository root:

```bash
cp apps/web/.env.example apps/web/.env
pnpm db:up && pnpm db:migrate
pnpm dev
```

Visit <http://localhost:3000/setup> to create the first account; it becomes the instance admin.
In development, mail goes to Mailpit (<http://localhost:8026>) and files to RustFS
(<http://localhost:9001>).

| Command (in `apps/web`) | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `pnpm dev`              | Nuxt dev server                                     |
| `pnpm test`             | Functional tests (Vitest) against the test database |
| `pnpm db:generate`      | Generate a migration from `server/db/schema`        |
| `pnpm db:migrate`       | Apply migrations                                    |
| `pnpm db:studio`        | Open Drizzle Studio                                 |
| `pnpm db:demo`          | Load demo data                                      |
| `pnpm db:reset`         | Wipe and recreate the database                      |
| `pnpm workflow:web`     | Inspect workflow runs                               |

## Configuration

| Variable                                         | Description                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `NUXT_DATABASE_URL`                              | Postgres connection string                                                          |
| `NUXT_PUBLIC_SITE_URL`                           | Public URL, used for auth and links in emails                                       |
| `NUXT_BETTER_AUTH_SECRET`, `NUXT_APP_SECRET`     | Random secrets of at least 32 characters (`openssl rand -base64 48`)                |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`       | Google OAuth client; redirect URI `<NUXT_PUBLIC_SITE_URL>/api/auth/callback/google` |
| `NUXT_SNS_TOPIC_ARNS`                            | SNS topics allowed to post SES events (comma-separated)                             |
| `NULIST_TRUSTED_PROXIES`                         | Proxies whose `X-Forwarded-For` is trusted (IPs, CIDRs or `loopback`)               |
| `NULIST_ALLOW_PRIVATE_TARGETS`                   | Let webhooks, SMTP and S3 reach private networks (default `false`)                  |
| `NULIST_ALLOWED_TARGETS`                         | Private hosts allowed anyway                                                        |
| `NULIST_SMTP_HOST`, `NULIST_SMTP_PORT`           | Instance-wide default SMTP server                                                   |
| `NULIST_S3_*`                                    | Instance-wide default S3 storage (endpoint, region, bucket, keys, public URL)       |
| `WORKFLOW_TARGET_WORLD`, `WORKFLOW_POSTGRES_URL` | Workflow backend (`@workflow/world-postgres`) and its database                      |
| `WORKFLOW_POSTGRES_WORKER_CONCURRENCY`           | Concurrent workflow steps; keep ≤ `WORKFLOW_POSTGRES_MAX_POOL_SIZE`                 |

For production, see the Docker setup in the [root README](../../README.md#production).

## License

[MIT](../../LICENSE)
