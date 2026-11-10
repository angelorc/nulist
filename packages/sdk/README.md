# @nulist/sdk

![version 0.1.2](https://img.shields.io/badge/version-0.1.2-yellow)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![dependencies 0](https://img.shields.io/badge/dependencies-0-green)

Typed TypeScript client for the [nulist](../../README.md) REST API. Zero runtime dependencies —
works in any runtime with a standard `fetch` (Node.js 20+, Bun, Deno, edge workers, browsers).

## Features

- ✉️ **Emails** — send single or batch transactional emails from a template or raw HTML, schedule, list and cancel them.
- 👥 **Contacts & lists** — create, update, list and unsubscribe contacts; manage mailing lists and their opt-in mode.
- 📣 **Broadcasts & templates** — draft, schedule, send and cancel campaigns; manage templates by id or slug.
- 🛡️ **Never throws** — every call resolves to `{ data, error, headers }`; HTTP errors, network failures and aborts land in `error`.
- 🔁 **Safe retries** — `idempotencyKey` on sends maps to the `Idempotency-Key` header, so a retry never sends twice.
- 🧩 **Fully typed** — request options, responses and every `error.name` are exported types; ships ESM and CJS.

## Install

```bash
pnpm add @nulist/sdk
```

## Usage

Create an API key in **Settings → API keys** of your nulist instance. The key decides the
organization the client acts on.

```ts
import { createClient } from '@nulist/sdk'

const nulist = createClient('ml_...', { baseUrl: 'https://mail.example.com' })

const { data, error } = await nulist.emails.send(
  {
    to: 'ada@example.com',
    template: 'welcome', // template id or slug
    data: { firstName: 'Ada' } // available as {{ data.firstName }}
  },
  { idempotencyKey: 'welcome/ada@example.com' }
)

if (error) console.error(error.name, error.message)
else console.log(data.id, data.status)
```

Both arguments can come from the environment: `createClient()` reads `NULIST_API_KEY` and
`NULIST_BASE_URL` (and optionally `NULIST_USER_AGENT`).

### Options

| Option      | Default                 | Description                                           |
| ----------- | ----------------------- | ----------------------------------------------------- |
| `baseUrl`   | `NULIST_BASE_URL`       | Origin of your instance; a trailing `/api/v1` is fine |
| `userAgent` | `nulist-node:<version>` | `User-Agent` sent with every request                  |
| `fetch`     | `globalThis.fetch`      | Custom fetch for proxies, instrumentation or tests    |

Every method also takes per-call `RequestOptions`: extra `headers` and an abort `signal`
(e.g. `AbortSignal.timeout(5_000)`).

## Resources

| Resource            | Methods                                                       |
| ------------------- | ------------------------------------------------------------- |
| `nulist.emails`     | `send`, `get`, `list`, `cancel`                               |
| `nulist.batch`      | `send` — up to 100 emails in one request, all or nothing      |
| `nulist.contacts`   | `create`, `get`, `list`, `update`, `remove`, `unsubscribe`    |
| `nulist.lists`      | `create`, `get`, `list`, `update`, `remove`                   |
| `nulist.broadcasts` | `create`, `get`, `list`, `update`, `remove`, `send`, `cancel` |
| `nulist.templates`  | `create`, `get`, `list`, `update`, `remove`                   |

Contacts are addressed by email, templates by id or slug. List calls accept `page` and
`pageSize` (1–100) and return `{ data, page, pageSize, total, hasMore }`.

```ts
await nulist.contacts.create({
  email: 'ada@example.com',
  firstName: 'Ada',
  attributes: { plan: 'pro' },
  listIds: [listId] // list UUIDs
})

await nulist.broadcasts.send(broadcastId, { scheduledAt: '2026-12-01T09:00:00+01:00' })
```

## Errors

Methods never throw or reject — only the constructor does, on misconfiguration.

```ts
const { error, headers } = await nulist.contacts.get('nobody@example.com')

if (error?.name === 'not_found') {
  // ...
}
if (error?.name === 'rate_limited') {
  console.log(headers?.['ratelimit-reset'])
}
```

`error.name` is one of `API_ERROR_NAMES` (sent by the API, e.g. `validation_error`,
`rate_limited`) or `CLIENT_ERROR_NAMES` (produced by the SDK, e.g. `request_aborted`).
`error.statusCode` is `null` when no response was received, and `error.details` carries
validation issues.

## License

[MIT](LICENSE)
