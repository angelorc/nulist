# nulist

![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=24](https://img.shields.io/badge/node-%3E%3D24-green)
![status alpha](https://img.shields.io/badge/status-alpha-orange)

Self-hosted email platform for newsletters and transactional mail. Manage contacts, lists and
segments, design templates, send broadcasts and API-driven emails through your own Amazon SES or
SMTP account. All from one Nuxt app backed by Postgres.

> [!WARNING]
> nulist is **alpha software**. APIs, database schema and configuration may change without notice.
> Read the [disclaimer](#disclaimer) before sending real mail with it.

## Features

- 👥 **Contacts, lists & segments**: CSV import/export, custom attributes, dynamic segments, topics and per-contact activity
- ✉️ **Broadcasts**: audience picker, pre-send checklist, test sends, scheduling, pause/resume/cancel and per-campaign reports
- ⚡ **Transactional email**: single and batch sends with idempotency keys, Liquid variables, scheduling and delivery events
- 🎨 **Templates**: drag-and-drop MJML editor (GrapesJS) or raw HTML, with Liquid personalization and plain-text fallback
- ✅ **Consent built in**: double opt-in, hosted subscribe and preference pages, one-click unsubscribe and a suppression list
- 📬 **Deliverability**: sending-domain verification (SPF, DKIM, DMARC, custom MAIL FROM) and SES bounce/complaint handling via SNS
- 🔌 **REST API & SDK**: `/api/v1` with API keys, outbound [Standard Webhooks](https://www.standardwebhooks.com/) and a typed [TypeScript SDK](packages/sdk)
- 🏢 **Multi-tenant**: organizations, members and roles, per-organization limits, audit log and an instance admin panel
- 🔁 **Durable workflows**: sends, imports, opt-ins and webhook deliveries run as resumable Postgres-backed workflows
- 🗂️ **File manager**: S3-compatible storage for images and assets used in templates

## Repository

| Path                           | Package       | Description                                           |
| ------------------------------ | ------------- | ----------------------------------------------------- |
| [`apps/web`](apps/web)         | `@nulist/web` | The nulist dashboard, REST API and background workers |
| [`packages/sdk`](packages/sdk) | `@nulist/sdk` | Zero-dependency TypeScript client for the REST API    |

Built with Nuxt 4, Nuxt UI, Drizzle ORM, Better Auth and the Workflow DevKit, in a pnpm +
Turborepo monorepo linted with oxlint and formatted with oxfmt.

## Quick start (development)

Requirements: Node.js 24+, pnpm 11 and Docker.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm db:up        # Postgres, Mailpit (SMTP catcher, UI on :8026) and RustFS (S3, console on :9001)
pnpm db:migrate
pnpm dev          # http://localhost:3000
```

Open <http://localhost:3000/setup> to create the first (admin) account. To load sample data, run
`pnpm db:demo`; `pnpm db:reset` wipes the database.

### Scripts

| Command                     | What it does                                 |
| --------------------------- | -------------------------------------------- |
| `pnpm dev`                  | Run every package in watch mode              |
| `pnpm build`                | Build the app and the SDK                    |
| `pnpm test`                 | Run the test suites (needs `pnpm db:up`)     |
| `pnpm typecheck`            | Type-check every package                     |
| `pnpm lint` / `pnpm format` | oxlint and oxfmt                             |
| `pnpm db:generate`          | Generate a Drizzle migration from the schema |

## Production

A production stack ships with the repository: Postgres, a one-shot migration job and the web
container, plus optional Caddy (automatic HTTPS) and RustFS (S3) profiles.

```bash
cp .env.prod.example .env.prod   # fill in the secrets and NULIST_VERSION
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

The stack runs the released images `ghcr.io/angelorc/nulist` and `ghcr.io/angelorc/nulist-migrate`,
pinned by `NULIST_VERSION`. To upgrade, bump it and run `pull` followed by `up -d`; the migration
job applies the new schema before the web container starts.

Add `--profile caddy` and/or `--profile storage` to enable the bundled reverse proxy and object
storage. See [`apps/web`](apps/web#configuration) for every environment variable.

## Using the API

```ts
import { createClient } from '@nulist/sdk'

const nulist = createClient('ml_...', { baseUrl: 'https://mail.example.com' })

const { data, error } = await nulist.emails.send({
  to: 'ada@example.com',
  template: 'welcome',
  data: { firstName: 'Ada' }
})
```

See the [SDK README](packages/sdk) for the full client.

## Disclaimer

nulist is provided **"as is"**, without warranty of any kind (see [LICENSE](LICENSE)). It is
early-stage software and has not been independently audited for security.

- **You are the sender.** You are solely responsible for the mail you send with nulist and for
  complying with the laws that apply to it — including CAN-SPAM, GDPR, the ePrivacy Directive,
  CASL and similar regulations — as well as your email provider's acceptable-use policy.
- **Consent matters.** Only email people who have opted in. Features such as double opt-in,
  unsubscribe links and suppression lists help, but do not make a campaign compliant on their own.
- **Deliverability is not guaranteed.** Inbox placement depends on your domain, provider,
  reputation and content; the authors accept no liability for blocked, lost or misdelivered mail,
  provider suspensions or sending costs.
- **Protect your data.** You operate the instance and hold your contacts' personal data. Keep it
  updated, back up your database and secure your secrets.
- **Trademarks.** Amazon SES, AWS and other product names are trademarks of their respective
  owners. nulist is an independent project and is not affiliated with or endorsed by them.

## License

[MIT](LICENSE) © 2026 Angelo Recca
