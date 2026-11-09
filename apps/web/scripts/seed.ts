/**
 * Demo data for local development: `pnpm seed`.
 *
 * - Creates the admin test user only when no user exists (never touches existing users),
 *   the "Default" organization (slug `default`) when it is missing, and the admin's
 *   owner membership in it.
 * - Inserts into that organization: lists, topics, ~800 contacts, templates, three sent
 *   broadcasts with realistic provider events, ~350 transactional/system emails,
 *   suppressions, SNS notifications and API request logs. Recipients use reserved
 *   `.example` domains, so nothing can reach a real inbox.
 * - Idempotent: skipped when the organization already has the "Newsletter (demo)" list.
 *
 * Runs under tsx outside Nuxt: relative imports only (no `#shared` aliases).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, asc, count, eq } from 'drizzle-orm'
import { Liquid } from 'liquidjs'
import mjml2html from 'mjml'
import type { PgTable } from 'drizzle-orm/pg-core'
import { createDatabase, schema } from '../server/db/client'
import type { Database, Executor } from '../server/db/client'
import { loadAppConfig } from '../server/lib/core/config'
import { roleLabel } from '../shared/auth/permissions'
import { TenantScope } from '../server/lib/core/TenantScope'
import { generalDefaults } from '../server/lib/settings/defaults'
import type {
  ContactStatus,
  JsonObject,
  MessageKind,
  MessageStatus,
  SuppressionReason
} from '../shared/types/domain'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------
/** A row of a tenant table before the seed organization is attached (`TenantScope.values`). */
type TenantRow<TTable extends PgTable> = Omit<TTable['$inferInsert'], 'organizationId'>

type ContactInsert = TenantRow<typeof schema.contacts>

type SubscriptionInsert = typeof schema.listSubscriptions.$inferInsert

type MessageInsert = TenantRow<typeof schema.messages>

type EventInsert = TenantRow<typeof schema.emailEvents>

type SuppressionInsert = TenantRow<typeof schema.suppressions>

type InboundInsert = TenantRow<typeof schema.inboundEvents>

type ApiLogInsert = TenantRow<typeof schema.apiLogs>

type AuditInsert = TenantRow<typeof schema.auditLogs>

/** The seed's admin user and the organization every demo row belongs to. */
interface Workspace {
  admin: { id: string; email: string }
  organization: { id: string; name: string; slug: string }
  /** The admin's membership in the organization. */
  membership: { id: string; role: string }
  scope: TenantScope
}

const SEED_MARKER = 'Newsletter (demo)'
const ADMIN = { email: 'admin@mlist.test', password: 'mlist-admin-123', name: 'Admin' }
const ORGANIZATION = { name: 'Default', slug: 'default' }
const COMPANY = { name: 'Acme', address: '548 Market St, San Francisco, CA 94104' }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.now()

/** Nothing is generated after this instant. */
const HORIZON = NOW - 2 * MINUTE

type Weighted<T> = readonly (readonly [T, number])[]

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
/** Deterministic PRNG (mulberry32) so every run produces the same audience shape. */
class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  between(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)]

    if (item === undefined) throw new Error('Cannot pick from an empty list')

    return item
  }

  weighted<T>(entries: Weighted<T>): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = this.next() * total

    for (const [value, weight] of entries) {
      roll -= weight

      if (roll <= 0) return value
    }

    const last = entries.at(-1)

    if (!last) throw new Error('Cannot pick from an empty list')

    return last[0]
  }

  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items]

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const a = copy[i]
      const b = copy[j]

      if (a !== undefined && b !== undefined) {
        copy[i] = b
        copy[j] = a
      }
    }

    return copy.slice(0, n)
  }
}

/** Time-ordered UUID (v7), matching the database default for primary keys. */
function uuidv7(ms: number): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Math.floor(ms), 0, 6)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sesMessageId(): string {
  return `0100${randomBytes(6).toString('hex')}-${randomUUID()}-000000`
}

function at(ms: number): Date {
  return new Date(Math.floor(ms))
}

async function insertChunks<TTable extends PgTable>(
  db: Executor,
  table: TTable,
  rows: TTable['$inferInsert'][],
  size = 500
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size))
  }
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  'Emma',
  'Liam',
  'Olivia',
  'Noah',
  'Ava',
  'Lucas',
  'Mia',
  'Leo',
  'Sofia',
  'Elias',
  'Chloe',
  'Mateo',
  'Zoe',
  'Hugo',
  'Nora',
  'Arthur',
  'Lea',
  'Felix',
  'Alice',
  'Oscar',
  'Maya',
  'Theo',
  'Ella',
  'Louis',
  'Clara',
  'Jonas',
  'Ines',
  'Marco',
  'Giulia',
  'Luca',
  'Sara',
  'Matteo',
  'Anna',
  'Paul',
  'Hannah',
  'Tom',
  'Lena',
  'Ben',
  'Julia',
  'Max',
  'Diego',
  'Lucia',
  'Pablo',
  'Valentina',
  'Yuki',
  'Haruto',
  'Aiko',
  'Ren',
  'Priya',
  'Arjun',
  'Ananya',
  'Rohan',
  'Chen',
  'Wei',
  'Mei',
  'Omar',
  'Layla',
  'Amir',
  'Zara',
  'Ethan',
  'Grace',
  'Isaac',
  'Ruby',
  'Freya',
  'Nils'
] as const

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Brown',
  'Garcia',
  'Miller',
  'Davis',
  'Martin',
  'Bernard',
  'Dubois',
  'Rossi',
  'Russo',
  'Ferrari',
  'Esposito',
  'Bianchi',
  'Muller',
  'Schmidt',
  'Schneider',
  'Fischer',
  'Weber',
  'Novak',
  'Kowalski',
  'Nowak',
  'Silva',
  'Santos',
  'Costa',
  'Fernandez',
  'Lopez',
  'Gonzalez',
  'Tanaka',
  'Sato',
  'Suzuki',
  'Kim',
  'Lee',
  'Park',
  'Patel',
  'Shah',
  'Singh',
  'Khan',
  'Ali',
  'Jensen',
  'Hansen',
  'Larsen',
  'Andersson',
  'Nilsson',
  'Virtanen',
  'Murphy',
  'Kelly',
  'Walsh',
  'Clarke',
  'Wright',
  'Walker',
  'Young',
  'King',
  'Scott',
  'Green',
  'Baker',
  'Hall'
] as const

/** Reserved `.example` domains (RFC 2606): realistic shape, undeliverable by design. */
const DOMAINS: Weighted<string> = [
  ['gmail.example', 34],
  ['outlook.example', 11],
  ['icloud.example', 9],
  ['yahoo.example', 7],
  ['proton.example', 4],
  ['gmx.example', 3],
  ['fastmail.example', 2],
  ['acme-corp.example', 5],
  ['globex.example', 4],
  ['initech.example', 4],
  ['hooli.example', 3],
  ['umbrella.example', 3],
  ['stark.example', 2]
]

const COUNTRIES: Weighted<string> = [
  ['US', 30],
  ['GB', 10],
  ['DE', 10],
  ['FR', 8],
  ['IT', 8],
  ['ES', 6],
  ['NL', 5],
  ['CA', 5],
  ['IN', 5],
  ['AU', 4],
  ['BR', 4],
  ['JP', 3],
  ['SE', 2]
]

type Plan = 'free' | 'pro' | 'team' | 'enterprise'

const PLANS: Weighted<Plan> = [
  ['free', 55],
  ['pro', 28],
  ['team', 12],
  ['enterprise', 5]
]

/** Monthly price on receipts (free contacts never receive one). */
const PRICES: Record<Plan, string> = {
  free: '$0.00',
  pro: '$29.00',
  team: '$99.00',
  enterprise: '$499.00'
}

const SOURCES: Weighted<string> = [
  ['form', 45],
  ['api', 30],
  ['import', 25]
]

const USER_AGENTS = {
  open: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)',
    'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928; Pro)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  ],
  click: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  ]
} as const

// ---------------------------------------------------------------------------
// Templates (MJML compiled with the mjml package; Liquid tags kept for sending)
// ---------------------------------------------------------------------------
interface NewsletterContent {
  heading: string
  intro: string
  items: { title: string; text: string; url: string; cta: string }[]
}

const MJML_HEAD = `<mj-head>
    <mj-attributes>
      <mj-all font-family="Geist, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" />
      <mj-button background-color="#171717" color="#ffffff" font-size="14px" font-weight="500" border-radius="6px" inner-padding="10px 18px" align="left" />
    </mj-attributes>
  </mj-head>`

const MJML_FOOTER = `<mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#737373">
          {{ company.name }} · {{ company.address }}<br />
          <a href="{{ preferences_url }}" style="color:#737373">Manage preferences</a> · <a href="{{ unsubscribe_url }}" style="color:#737373">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>`

function newsletterMjml(content: NewsletterContent): string {
  const items = content.items
    .map(
      (item) => `
        <mj-text font-size="17px" font-weight="600" color="#171717" padding-top="24px">${item.title}</mj-text>
        <mj-text>${item.text}</mj-text>
        <mj-button href="${item.url}">${item.cta}</mj-button>`
    )
    .join('')

  return `<mjml>
  ${MJML_HEAD}
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column><mj-text font-size="13px" color="#737373">{{ company.name }}</mj-text></mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">${content.heading}</mj-text>
        <mj-text>Hi {{ contact.first_name | default: "there" }}, ${content.intro}</mj-text>${items}
      </mj-column>
    </mj-section>
    ${MJML_FOOTER}
  </mj-body>
</mjml>`
}

const TRANSACTIONAL_MJML = `<mjml>
  ${MJML_HEAD}
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column><mj-text font-size="13px" color="#737373">{{ company.name }}</mj-text></mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">{{ data.heading }}</mj-text>
        <mj-text>{{ data.body }}</mj-text>
        <mj-button href="{{ data.cta_url }}">{{ data.cta_label }}</mj-button>
        <mj-text font-size="13px" color="#737373">If you did not expect this email, you can ignore it.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#737373">{{ company.name }} · {{ company.address }}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

const WELCOME_MJML = `<mjml>
  ${MJML_HEAD}
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column><mj-text font-size="13px" color="#737373">{{ company.name }}</mj-text></mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">Welcome aboard, {{ contact.first_name | default: "there" }}</mj-text>
        <mj-text>Your {{ data.plan | default: "free" }} account is ready. Here are three things most teams do in their first week.</mj-text>
        <mj-text>1. Invite your teammates<br />2. Connect your data source<br />3. Set up your first report</mj-text>
        <mj-button href="https://acme.test/getting-started">Open the getting started guide</mj-button>
        <mj-text font-size="13px" color="#737373">Questions? Reply to this email, a human reads every message. Or browse the <a href="https://acme.test/docs" style="color:#171717">documentation</a>.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#737373">{{ company.name }} · {{ company.address }}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

async function compile(mjml: string): Promise<string> {
  const result = await mjml2html(mjml, { validationLevel: 'soft', keepComments: false })

  return result.html
}

// ---------------------------------------------------------------------------
// Domain model of the simulation
// ---------------------------------------------------------------------------
interface SeedContact {
  row: ContactInsert & {
    id: string
    email: string
    createdAt: Date
    attributes: JsonObject
  }
  plan: Plan
  /** 0..1 engagement propensity, stable across sends. */
  affinity: number
  /** When the contact stopped being mailable (bounce, complaint, global unsubscribe). */
  blockedAt: number | null
  status: ContactStatus
  lastOpenedAt: number | null
  lastClickedAt: number | null
  softBounces: number
}

interface SeedSubscription {
  row: SubscriptionInsert & { listId: string; contactId: string }
}

type BroadcastInsert = TenantRow<typeof schema.broadcasts>

interface MessageSpec {
  kind: MessageKind
  time: number
  contact: SeedContact
  subject: string
  category: string
  html: string
  text: string
  variables: JsonObject
  templateId?: string
  idempotencyKey?: string
}

interface TransactionalSpec extends MessageSpec {
  openRate: number
  clickRate: number
  links: Weighted<string>
}

interface DeliveryPlan {
  messageId: string
  contact: SeedContact | null
  toEmail: string
  broadcastId: string | null
  sentAt: number
  openRate: number
  clickRate: number
  hardBounce: number
  softBounce: number
  links: Weighted<string>
}

interface DeliveryOutcome {
  status: MessageStatus
  providerMessageId: string
  sentAt: number
  deliveredAt: number | null
  openedAt: number | null
  clickedAt: number | null
  openCount: number
  clickCount: number
  error: string | null
  lastEventAt: number
}

/** Generates provider events (send → delivery → opens → clicks, or bounces) for one email. */
class EmailSimulator {
  readonly events: EventInsert[] = []

  constructor(private readonly r: Random) {}

  private ip(): string {
    return `${this.r.pick(['198.51.100', '203.0.113', '192.0.2'])}.${this.r.int(2, 254)}`
  }

  push(
    plan: Pick<DeliveryPlan, 'messageId' | 'contact' | 'broadcastId'>,
    type: EventInsert['type'],
    time: number,
    data: JsonObject
  ) {
    this.events.push({
      messageId: plan.messageId,
      contactId: plan.contact?.row.id ?? null,
      broadcastId: plan.broadcastId,
      type,
      occurredAt: at(time),
      createdAt: at(time + this.r.between(200, 4000)),
      data
    })
  }

  deliver(plan: DeliveryPlan): DeliveryOutcome {
    const r = this.r
    const providerMessageId = sesMessageId()
    this.push(plan, 'send', plan.sentAt, { provider: 'ses', providerMessageId })

    const outcome: DeliveryOutcome = {
      status: 'sent',
      providerMessageId,
      sentAt: plan.sentAt,
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      openCount: 0,
      clickCount: 0,
      error: null,
      lastEventAt: plan.sentAt
    }

    if (r.chance(plan.hardBounce) || r.chance(plan.softBounce)) {
      const hard = r.chance(plan.hardBounce / (plan.hardBounce + plan.softBounce || 1))
      const time = plan.sentAt + r.between(2 * SECOND, 45 * SECOND)

      const bounce = hard
        ? {
            type: 'hard',
            bounceType: 'Permanent',
            bounceSubType: 'General',
            status: '5.1.1',
            diagnosticCode:
              'smtp; 550 5.1.1 The email account that you tried to reach does not exist'
          }
        : {
            type: 'soft',
            bounceType: 'Transient',
            bounceSubType: 'MailboxFull',
            status: '4.2.2',
            diagnosticCode: 'smtp; 452 4.2.2 The recipient mailbox is full'
          }

      this.push(plan, 'bounce', time, {
        ...bounce,
        action: 'failed',
        feedbackId: `${randomBytes(16).toString('hex')}-000000`,
        reportingMTA: 'dsn; a8-30.smtp-out.amazonses.com',
        suppressed: hard
      })
      outcome.status = 'bounced'
      outcome.error = `${hard ? 'Hard' : 'Soft'} bounce: ${bounce.bounceType}/${bounce.bounceSubType} (${bounce.diagnosticCode.slice(0, 22)})`
      outcome.lastEventAt = time

      if (plan.contact) {
        if (hard) {
          plan.contact.status = 'bounced'
          plan.contact.blockedAt = time
        } else {
          plan.contact.softBounces++
        }
      }

      return outcome
    }

    const deliveredAt = plan.sentAt + r.between(0.8 * SECOND, 6 * SECOND)
    this.push(plan, 'delivery', deliveredAt, {
      timestamp: at(deliveredAt).toISOString(),
      recipients: [plan.toEmail],
      processingTimeMillis: Math.round(deliveredAt - plan.sentAt),
      smtpResponse: '250 2.0.0 OK  1731160000 a640c23a62f3a-aa5f37cc2e1si1012 - gsmtp',
      reportingMTA: 'a8-30.smtp-out.amazonses.com'
    })
    outcome.status = 'delivered'
    outcome.deliveredAt = deliveredAt
    outcome.lastEventAt = deliveredAt

    const affinity = plan.contact?.affinity ?? r.next()
    const pOpen = Math.min(0.97, plan.openRate * (0.35 + 1.3 * affinity))

    if (!r.chance(pOpen)) return outcome

    // Apple Mail Privacy Protection prefetches within minutes; humans open later.
    const firstOpen =
      deliveredAt +
      (r.chance(0.22)
        ? r.between(20 * SECOND, 8 * MINUTE)
        : Math.min(r.exponential(4 * HOUR), 6 * DAY))

    if (firstOpen > HORIZON) return outcome
    const opens = [firstOpen]

    if (r.chance(0.35)) {
      for (let i = r.int(1, 3); i > 0; i--)
        opens.push((opens.at(-1) ?? firstOpen) + r.exponential(10 * HOUR))
    }

    const ip = this.ip()

    for (const time of opens.filter((t) => t < HORIZON)) {
      this.push(plan, 'open', time, {
        timestamp: at(time).toISOString(),
        ipAddress: ip,
        userAgent: r.pick(USER_AGENTS.open),
        isBotEvent: false
      })
      outcome.openCount++
      outcome.lastEventAt = Math.max(outcome.lastEventAt, time)
    }

    outcome.openedAt = firstOpen

    if (plan.contact) {
      plan.contact.lastOpenedAt = Math.max(
        plan.contact.lastOpenedAt ?? 0,
        ...opens.filter((t) => t < HORIZON)
      )
    }

    const pClick =
      plan.openRate > 0
        ? Math.min(0.9, (plan.clickRate / plan.openRate) * (0.4 + 1.2 * affinity))
        : 0

    if (!plan.links.length || !r.chance(pClick)) return outcome

    const firstClick = firstOpen + r.between(15 * SECOND, 25 * MINUTE)

    if (firstClick > HORIZON) return outcome
    const firstLink = r.weighted(plan.links)
    const clicks: [number, string][] = [[firstClick, firstLink]]

    if (r.chance(0.25) && plan.links.length > 1) {
      const others = plan.links.filter(([url]) => url !== firstLink)
      clicks.push([firstClick + r.between(30 * SECOND, 10 * MINUTE), r.weighted(others)])
    }

    if (r.chance(0.15)) clicks.push([firstClick + r.between(1 * HOUR, 2 * DAY), firstLink])
    const userAgent = r.pick(USER_AGENTS.click)

    for (const [time, link] of clicks.filter(([t]) => t < HORIZON)) {
      this.push(plan, 'click', time, {
        timestamp: at(time).toISOString(),
        ipAddress: ip,
        userAgent,
        link,
        linkTags: {},
        isBotEvent: false
      })
      outcome.clickCount++
      outcome.lastEventAt = Math.max(outcome.lastEventAt, time)
    }

    outcome.clickedAt = firstClick

    if (plan.contact) {
      plan.contact.lastClickedAt = Math.max(
        plan.contact.lastClickedAt ?? 0,
        ...clicks.flatMap(([t]) => (t < HORIZON ? [t] : []))
      )
    }

    return outcome
  }
}

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------
/** Generic content stored in the "Monthly newsletter" template; broadcasts replace it. */
const NEWSLETTER_TEMPLATE: NewsletterContent = {
  heading: 'This month at {{ company.name }}',
  intro: 'here is what we shipped and what is coming next.',
  items: [
    {
      title: 'Headline story',
      text: 'Two or three sentences about the most important update.',
      url: 'https://acme.test/blog',
      cta: 'Read more'
    },
    {
      title: 'Also new',
      text: 'A smaller improvement worth knowing about.',
      url: 'https://acme.test/changelog',
      cta: 'See the changelog'
    }
  ]
}

interface BroadcastPlan {
  name: string
  subject: string
  preheader: string
  list: 'newsletter' | 'product'
  daysAgo: number
  hourUtc: number
  openRate: number
  clickRate: number
  hardBounce: number
  softBounce: number
  unsubscribeRate: number
  complaints: number
  content: NewsletterContent
}

const BROADCASTS: BroadcastPlan[] = [
  {
    name: 'September newsletter',
    subject: 'Dashboards that update themselves',
    preheader: 'Plus: a new pricing page and three customer stories.',
    list: 'newsletter',
    daysAgo: 52,
    hourUtc: 9,
    openRate: 0.43,
    clickRate: 0.068,
    hardBounce: 0.012,
    softBounce: 0.004,
    unsubscribeRate: 0.005,
    complaints: 1,
    content: {
      heading: 'Dashboards that update themselves',
      intro: 'here is what shipped in September.',
      items: [
        {
          title: 'Live dashboards',
          text: 'Charts now refresh as data arrives, with no manual reloads.',
          url: 'https://acme.test/blog/live-dashboards',
          cta: 'Read the announcement'
        },
        {
          title: 'Simpler pricing',
          text: 'One plan per team size, billed monthly or yearly.',
          url: 'https://acme.test/pricing',
          cta: 'See pricing'
        },
        {
          title: 'How Globex cut reporting time by 70%',
          text: 'A short case study from their analytics team.',
          url: 'https://acme.test/customers/globex',
          cta: 'Read the story'
        }
      ]
    }
  },
  {
    name: 'Product update: workflows',
    subject: 'Workflows are here',
    preheader: 'Automate the reports you build every Monday.',
    list: 'product',
    daysAgo: 24,
    hourUtc: 15,
    openRate: 0.47,
    clickRate: 0.085,
    hardBounce: 0.008,
    softBounce: 0.003,
    unsubscribeRate: 0.003,
    complaints: 1,
    content: {
      heading: 'Workflows are here',
      intro: 'you can now chain queries, alerts and exports into a single workflow.',
      items: [
        {
          title: 'Build your first workflow',
          text: 'Start from a template or drag steps onto the canvas.',
          url: 'https://acme.test/docs/workflows',
          cta: 'Open the docs'
        },
        {
          title: 'Watch the 5 minute demo',
          text: 'Our product lead walks through three real workflows.',
          url: 'https://acme.test/videos/workflows',
          cta: 'Watch the demo'
        },
        {
          title: 'Full changelog',
          text: 'Every fix and improvement from this release.',
          url: 'https://acme.test/changelog',
          cta: 'View changelog'
        }
      ]
    }
  },
  {
    name: 'November newsletter',
    subject: 'Year in review, early access and a webinar',
    preheader: 'Join us on December 3 for a live Q&A.',
    list: 'newsletter',
    daysAgo: 4,
    hourUtc: 9,
    openRate: 0.38,
    clickRate: 0.048,
    hardBounce: 0.005,
    softBounce: 0.003,
    unsubscribeRate: 0.004,
    complaints: 0,
    content: {
      heading: 'Your year in review is ready',
      intro: "we pulled together the numbers behind your team's year.",
      items: [
        {
          title: 'See your year in review',
          text: 'Queries run, dashboards shared and hours saved.',
          url: 'https://acme.test/year-in-review',
          cta: 'Open your review'
        },
        {
          title: 'Live webinar on December 3',
          text: 'Ask our engineers anything about the 2027 roadmap.',
          url: 'https://acme.test/events/roadmap-webinar',
          cta: 'Save your seat'
        },
        {
          title: 'Early access: AI summaries',
          text: 'Get plain-language summaries of any dashboard.',
          url: 'https://acme.test/early-access',
          cta: 'Request access'
        }
      ]
    }
  }
]

/**
 * The admin user, the "Default" organization and the admin's owner membership.
 * Users and members are inserted directly (Better Auth hooks do not run here);
 * whatever already exists is reused, never modified.
 */
class WorkspaceSeeder {
  constructor(private readonly db: Database) {}

  async ensure(): Promise<Workspace> {
    const admin = await this.ensureAdmin()
    const organization = await this.ensureOrganization()
    const membership = await this.ensureMembership(organization, admin)
    const scope = new TenantScope(organization.id)
    await this.ensureSettings(scope, organization.name)

    return { admin, organization, membership, scope }
  }

  private async ensureAdmin(): Promise<{ id: string; email: string }> {
    const [users] = await this.db.select({ value: count() }).from(schema.user)

    if ((users?.value ?? 0) === 0) {
      const [created] = await this.db
        .insert(schema.user)
        .values({ name: ADMIN.name, email: ADMIN.email, emailVerified: true, role: 'admin' })
        .returning()

      if (!created) throw new Error('Could not create the admin user')
      await this.db.insert(schema.account).values({
        accountId: created.id,
        providerId: 'credential',
        userId: created.id,
        password: await hashPassword(ADMIN.password),
        updatedAt: new Date()
      })
      console.log(`Created admin user ${ADMIN.email} (password: ${ADMIN.password})`)

      return { id: created.id, email: created.email }
    }

    const [admin] = await this.db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.role, 'admin'))
      .orderBy(asc(schema.user.createdAt))
      .limit(1)

    const [anyone] = admin
      ? [admin]
      : await this.db
          .select({ id: schema.user.id, email: schema.user.email })
          .from(schema.user)
          .orderBy(asc(schema.user.createdAt))
          .limit(1)

    if (!anyone) throw new Error('No user found')

    return anyone
  }

  /** The "Default" organization (created by the organizations migration on existing installs). */
  private async ensureOrganization(): Promise<Workspace['organization']> {
    const o = schema.organization
    const columns = { id: o.id, name: o.name, slug: o.slug }
    const [existing] = await this.db.select(columns).from(o).where(eq(o.slug, ORGANIZATION.slug))

    if (existing) return existing

    const [created] = await this.db
      .insert(o)
      .values({ ...ORGANIZATION, createdAt: at(NOW - 90 * DAY) })
      .returning(columns)

    if (!created) throw new Error('Could not create the organization')
    console.log(`Created organization "${created.name}" (${created.slug})`)

    return created
  }

  private async ensureMembership(
    organization: Workspace['organization'],
    user: Workspace['admin']
  ): Promise<Workspace['membership']> {
    const m = schema.member
    const columns = { id: m.id, role: m.role }

    const [existing] = await this.db
      .select(columns)
      .from(m)
      .where(and(eq(m.organizationId, organization.id), eq(m.userId, user.id)))

    if (existing) return existing

    const [created] = await this.db
      .insert(m)
      .values({
        organizationId: organization.id,
        userId: user.id,
        role: 'owner',
        createdAt: at(NOW - 90 * DAY)
      })
      .returning(columns)

    if (!created) throw new Error('Could not add the admin to the organization')
    console.log(`Added ${user.email} to "${organization.name}" as owner`)

    return created
  }

  /** The general settings a new organization starts with (as `OrganizationService.initialize`). */
  private async ensureSettings(scope: TenantScope, name: string): Promise<void> {
    const settings = schema.settings

    await this.db
      .insert(settings)
      .values(scope.values({ key: 'general' as const, value: generalDefaults(name) }))
      .onConflictDoNothing({ target: [settings.organizationId, settings.key] })
  }
}

class DemoSeeder {
  private readonly r = new Random(20261109)
  private readonly sim = new EmailSimulator(this.r)
  private readonly liquid = new Liquid({ outputEscape: 'escape' })

  private readonly contacts: SeedContact[] = []
  private readonly subscriptions: SeedSubscription[] = []
  private readonly messages: MessageInsert[] = []
  private readonly suppressions = new Map<string, SuppressionInsert>()
  private readonly ids = {
    lists: {
      newsletter: uuidv7(NOW - 89 * DAY),
      product: uuidv7(NOW - 89 * DAY + 1),
      beta: uuidv7(NOW - 89 * DAY + 2)
    },
    topics: { product: uuidv7(NOW - 89 * DAY + 3), events: uuidv7(NOW - 89 * DAY + 4) },
    templates: { newsletter: uuidv7(NOW - 70 * DAY), welcome: uuidv7(NOW - 75 * DAY) }
  }

  private readonly scope: TenantScope

  constructor(
    private readonly db: Database,
    private readonly workspace: Workspace
  ) {
    this.scope = workspace.scope
  }

  async run(): Promise<void> {
    const { scope } = this
    const organization = this.workspace.organization

    const [marker] = await this.db
      .select({ id: schema.lists.id })
      .from(schema.lists)
      .where(and(scope.eq(schema.lists.organizationId), eq(schema.lists.name, SEED_MARKER)))

    if (marker) {
      console.log(
        `Demo data already present in "${organization.name}" (list "${SEED_MARKER}" exists). Nothing to do.`
      )

      return
    }

    const [welcomeSlugTaken] = await this.db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(and(scope.eq(schema.templates.organizationId), eq(schema.templates.slug, 'welcome')))

    const [auditRows] = await this.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(scope.eq(schema.auditLogs.organizationId))

    this.buildAudience()

    const html = {
      newsletterTemplate: await compile(newsletterMjml(NEWSLETTER_TEMPLATE)),
      welcome: await compile(WELCOME_MJML),
      layout: await compile(TRANSACTIONAL_MJML)
    }

    const specs = await this.transactionalSpecs(html.welcome, html.layout)
    const broadcasts = await this.simulateTimeline(specs)
    await this.addEdgeCases(html.layout)
    const inbound = this.buildInboundEvents()
    const apiLogs = this.buildApiLogs()
    this.addManualSuppressions()

    await this.db.transaction(async (db) => {
      await db.insert(schema.topics).values(
        scope.valuesMany<TenantRow<typeof schema.topics>>([
          {
            id: this.ids.topics.product,
            name: 'Product news',
            description: 'Launches, improvements and the changelog.',
            defaultSubscribed: true,
            createdAt: at(NOW - 89 * DAY)
          },
          {
            id: this.ids.topics.events,
            name: 'Events & webinars',
            description: 'Invitations to live sessions and meetups.',
            defaultSubscribed: false,
            createdAt: at(NOW - 89 * DAY)
          }
        ])
      )
      await db.insert(schema.lists).values(
        scope.valuesMany<TenantRow<typeof schema.lists>>([
          {
            id: this.ids.lists.newsletter,
            name: SEED_MARKER,
            description: 'Monthly roundup of product news and stories.',
            optIn: 'single',
            isPublic: true,
            createdAt: at(NOW - 89 * DAY)
          },
          {
            id: this.ids.lists.product,
            name: 'Product updates (demo)',
            description: 'Release announcements. Requires email confirmation.',
            optIn: 'double',
            isPublic: true,
            createdAt: at(NOW - 89 * DAY)
          },
          {
            id: this.ids.lists.beta,
            name: 'Beta testers (demo)',
            description: 'Early access programme, invite only.',
            optIn: 'single',
            isPublic: false,
            createdAt: at(NOW - 80 * DAY)
          }
        ])
      )
      await insertChunks(
        db,
        schema.contacts,
        this.contacts.map((c) =>
          scope.values({
            ...c.row,
            status: c.status,
            softBounceCount: c.softBounces,
            lastOpenedAt: c.lastOpenedAt ? at(c.lastOpenedAt) : null,
            lastClickedAt: c.lastClickedAt ? at(c.lastClickedAt) : null,
            updatedAt: at(
              Math.max(
                c.row.createdAt.getTime(),
                c.lastClickedAt ?? 0,
                c.lastOpenedAt ?? 0,
                c.blockedAt ?? 0
              )
            )
          })
        )
      )
      await insertChunks(
        db,
        schema.listSubscriptions,
        this.subscriptions.map((s) => s.row)
      )
      await insertChunks(db, schema.contactTopics, this.contactTopics())
      await db.insert(schema.templates).values(
        scope.valuesMany<TenantRow<typeof schema.templates>>([
          {
            id: this.ids.templates.newsletter,
            name: 'Monthly newsletter',
            kind: 'marketing',
            editor: 'code',
            subject: 'News from {{ company.name }}',
            preheader: 'What shipped this month',
            mjml: newsletterMjml(NEWSLETTER_TEMPLATE),
            html: html.newsletterTemplate,
            createdAt: at(NOW - 70 * DAY),
            updatedAt: at(NOW - 5 * DAY)
          },
          {
            id: this.ids.templates.welcome,
            name: 'Welcome email',
            slug: welcomeSlugTaken ? 'welcome-demo' : 'welcome',
            kind: 'transactional',
            editor: 'code',
            subject: 'Welcome to {{ company.name }}, {{ contact.first_name | default: "there" }}',
            mjml: WELCOME_MJML,
            html: html.welcome,
            createdAt: at(NOW - 75 * DAY),
            updatedAt: at(NOW - 75 * DAY)
          }
        ])
      )
      await db.insert(schema.broadcasts).values(scope.valuesMany(broadcasts))
      await insertChunks(db, schema.messages, scope.valuesMany(this.messages), 400)
      await insertChunks(db, schema.emailEvents, scope.valuesMany(this.sim.events))
      await insertChunks(db, schema.suppressions, scope.valuesMany([...this.suppressions.values()]))
      await insertChunks(db, schema.inboundEvents, inbound)
      await insertChunks(db, schema.apiLogs, scope.valuesMany(apiLogs))

      if ((auditRows?.value ?? 0) === 0)
        await insertChunks(db, schema.auditLogs, scope.valuesMany(this.buildAuditLog(broadcasts)))
    })

    console.log(
      [
        'Demo data created:',
        `  ${this.contacts.length} contacts, ${this.subscriptions.length} list memberships`,
        `  ${broadcasts.length} broadcasts, ${this.messages.length} emails, ${this.sim.events.length} provider events`,
        `  ${this.suppressions.size} suppressions, ${inbound.length} SNS notifications, ${apiLogs.length} API requests`,
        (auditRows?.value ?? 0) === 0 ? '  audit log entries' : '  audit log skipped (not empty)',
        `Organization: "${organization.name}" (${organization.id})`,
        `Sign in at http://localhost:3000/login as ${this.workspace.admin.email}`
      ].join('\n')
    )
  }

  // Audience -----------------------------------------------------------------
  private buildAudience(): void {
    const r = this.r
    const used = new Set<string>()

    for (let i = 0; i < 800; i++) {
      const imported = i < 150
      const daysAgo = imported ? 88 + r.next() * 0.01 : 87 * r.next() ** 1.25
      const createdAt = Math.min(NOW - daysAgo * DAY - r.between(0, 6 * HOUR), HORIZON - HOUR)
      const first = r.pick(FIRST_NAMES)
      const last = r.pick(LAST_NAMES)
      const domain = r.weighted(DOMAINS)
      const style = r.int(0, 3)

      let local =
        style === 0
          ? `${first}.${last}`
          : style === 1
            ? `${first[0]}${last}`
            : style === 2
              ? `${first}${last[0]}`
              : `${first}_${last}`

      local = local.toLowerCase()
      let email = `${local}@${domain}`

      while (used.has(email)) email = `${local}${r.int(2, 99)}@${domain}`
      used.add(email)

      const source = imported ? 'import' : r.weighted(SOURCES)
      const plan = r.weighted(PLANS)

      const contact: SeedContact = {
        row: {
          id: uuidv7(createdAt),
          email,
          firstName: r.chance(0.94) ? first : null,
          lastName: r.chance(0.85) ? last : null,
          attributes: {
            plan,
            country: r.weighted(COUNTRIES),
            signup_date: at(createdAt).toISOString().slice(0, 10)
          },
          source,
          consentIp: source === 'form' ? `203.0.113.${r.int(2, 254)}` : null,
          consentAt: source === 'form' ? at(createdAt) : null,
          createdAt: at(createdAt)
        },
        plan,
        affinity: r.next() ** 1.4,
        blockedAt: null,
        status: 'active',
        lastOpenedAt: null,
        lastClickedAt: null,
        softBounces: 0
      }

      this.contacts.push(contact)
      this.subscribe(contact, createdAt)
    }

    this.contacts.sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime())

    // A few people leave everything through the preference center (no email event).
    for (const contact of r.sample(this.contacts, 10)) {
      const time = contact.row.createdAt.getTime() + r.between(3 * DAY, 80 * DAY)

      if (time < HORIZON) this.unsubscribeEverywhere(contact, time, 'preference_center')
    }
  }

  private subscribe(contact: SeedContact, createdAt: number): void {
    const r = this.r

    const add = (listId: string, subscribedAt: number, confirmedAt: number | null) => {
      this.subscriptions.push({
        row: {
          listId,
          contactId: contact.row.id,
          status: confirmedAt ? 'confirmed' : 'unconfirmed',
          confirmedAt: confirmedAt ? at(confirmedAt) : null,
          unsubscribedAt: null,
          createdAt: at(subscribedAt)
        }
      })
    }

    if (r.chance(0.88))
      add(this.ids.lists.newsletter, createdAt, createdAt + r.between(1 * SECOND, 30 * SECOND))

    if (r.chance(0.42)) {
      const subscribedAt = Math.min(
        createdAt + (r.chance(0.6) ? 0 : r.between(1 * DAY, 30 * DAY)),
        HORIZON - HOUR
      )

      const confirmedAt = r.chance(0.09)
        ? null
        : Math.min(subscribedAt + r.exponential(3 * HOUR), HORIZON - MINUTE)

      add(this.ids.lists.product, subscribedAt, confirmedAt)
    }

    if (r.chance(contact.plan === 'free' ? 0.04 : 0.25)) {
      const subscribedAt = Math.min(
        Math.max(createdAt, NOW - 80 * DAY) + r.between(0, 10 * DAY),
        HORIZON - HOUR
      )

      add(this.ids.lists.beta, subscribedAt, subscribedAt)
    }
  }

  private subscriptionsOf(contactId: string): SeedSubscription[] {
    return this.subscriptions.filter((s) => s.row.contactId === contactId)
  }

  private unsubscribeFromList(contactId: string, listId: string, time: number): void {
    for (const sub of this.subscriptionsOf(contactId)) {
      if (sub.row.listId === listId && sub.row.status !== 'unsubscribed') {
        sub.row.status = 'unsubscribed'
        sub.row.unsubscribedAt = at(time)
      }
    }
  }

  private unsubscribeEverywhere(contact: SeedContact, time: number, source: string): void {
    for (const sub of this.subscriptionsOf(contact.row.id))
      this.unsubscribeFromList(contact.row.id, sub.row.listId, time)
    contact.status = 'unsubscribed'
    contact.blockedAt = contact.blockedAt ?? time
    this.suppress(contact.row.email, 'unsubscribe', source, time)
  }

  private suppress(email: string, reason: SuppressionReason, source: string, time: number): void {
    const rank: Record<SuppressionReason, number> = {
      unsubscribe: 1,
      soft_bounce: 1,
      manual: 2,
      hard_bounce: 2,
      complaint: 3
    }

    const existing = this.suppressions.get(email)

    if (existing && rank[existing.reason] >= rank[reason]) return
    this.suppressions.set(email, { email, reason, source, createdAt: at(time) })
  }

  private addManualSuppressions(): void {
    const entries: [string, number][] = [
      ['abuse@globex.example', 61],
      ['postmaster@initech.example', 33],
      ['legal@hooli.example', 9]
    ]

    for (const [email, daysAgo] of entries)
      this.suppress(email, 'manual', 'dashboard', NOW - daysAgo * DAY)
  }

  private contactTopics() {
    const rows: (typeof schema.contactTopics.$inferInsert)[] = []

    const productMembers = new Set(
      this.subscriptions
        .filter((s) => s.row.listId === this.ids.lists.product)
        .map((s) => s.row.contactId)
    )

    for (const contact of this.contacts) {
      if (!productMembers.has(contact.row.id)) continue
      rows.push({
        contactId: contact.row.id,
        topicId: this.ids.topics.product,
        subscribed: this.r.chance(0.93),
        updatedAt: contact.row.createdAt
      })

      if (this.r.chance(0.4))
        rows.push({
          contactId: contact.row.id,
          topicId: this.ids.topics.events,
          subscribed: this.r.chance(0.6),
          updatedAt: contact.row.createdAt
        })
    }

    return rows
  }

  /** Whether a contact can receive a list's broadcast at `time`. */
  private isRecipient(contact: SeedContact, listId: string, time: number): boolean {
    if (contact.blockedAt !== null && contact.blockedAt <= time) return false

    return this.subscriptionsOf(contact.row.id).some(
      (s) =>
        s.row.listId === listId &&
        s.row.confirmedAt instanceof Date &&
        s.row.confirmedAt.getTime() < time &&
        !(s.row.unsubscribedAt instanceof Date && s.row.unsubscribedAt.getTime() <= time)
    )
  }

  // Sending timeline ----------------------------------------------------------
  /**
   * Replays every send in chronological order so contact state stays consistent:
   * an address that hard bounced on a receipt is suppressed for the next broadcast,
   * and a complaint on a broadcast suppresses the receipts that follow it.
   */
  private async simulateTimeline(specs: TransactionalSpec[]): Promise<BroadcastInsert[]> {
    const plans = BROADCASTS.map((plan) => {
      const day = new Date(NOW - plan.daysAgo * DAY)

      return {
        plan,
        start: Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate(),
          plan.hourUtc,
          this.r.int(0, 20)
        )
      }
    }).sort((a, b) => a.start - b.start)

    const queue = [...specs].sort((a, b) => a.time - b.time)
    const rows: BroadcastInsert[] = []
    let next = 0

    for (const { plan, start } of plans) {
      for (; next < queue.length && (queue[next]?.time ?? Infinity) < start; next++) {
        const spec = queue[next]

        if (spec) this.sendTransactional(spec)
      }

      rows.push(await this.sendBroadcast(plan, start))
    }

    for (const spec of queue.slice(next)) this.sendTransactional(spec)

    return rows
  }

  private async sendBroadcast(plan: BroadcastPlan, start: number): Promise<BroadcastInsert> {
    const r = this.r
    const listId = plan.list === 'newsletter' ? this.ids.lists.newsletter : this.ids.lists.product
    const broadcastId = uuidv7(start - 2 * DAY)
    const recipients = this.contacts.filter((c) => this.isRecipient(c, listId, start))

    const links: Weighted<string> = plan.content.items.map(
      (item, i) => [item.url, [6, 3, 2][i] ?? 1] as const
    )

    const complainers = new Set(
      r.sample(
        recipients.map((c) => c.row.id),
        plan.complaints
      )
    )

    const snapshot = await compile(newsletterMjml(plan.content))

    recipients.forEach((contact, index) => {
      const messageId = uuidv7(start + index)

      const outcome = this.sim.deliver({
        messageId,
        contact,
        toEmail: contact.row.email,
        broadcastId,
        sentAt: start + index * 72 + r.between(0, 40),
        openRate: plan.openRate,
        clickRate: plan.clickRate,
        hardBounce: plan.hardBounce,
        softBounce: plan.softBounce,
        links
      })

      const ref = { messageId, contact, broadcastId }

      if (outcome.deliveredAt && complainers.has(contact.row.id)) {
        const time = outcome.deliveredAt + r.between(6 * HOUR, 3 * DAY)

        if (time < HORIZON) {
          this.sim.push(ref, 'complaint', time, {
            userAgent: 'Yahoo!-Mail-Feedback/2.0',
            feedbackId: `${randomBytes(16).toString('hex')}-000000`,
            arrivalDate: at(time).toISOString(),
            feedbackType: 'abuse',
            complaintSubType: null
          })
          outcome.status = 'complained'
          outcome.lastEventAt = Math.max(outcome.lastEventAt, time)
          contact.status = 'complained'
          contact.blockedAt = time
          this.unsubscribeFromList(contact.row.id, listId, time)
          this.suppress(contact.row.email, 'complaint', 'ses', time)
        }
      } else if (outcome.deliveredAt && r.chance(plan.unsubscribeRate * (1.6 - contact.affinity))) {
        const time = (outcome.openedAt ?? outcome.deliveredAt) + r.between(1 * MINUTE, 2 * DAY)

        if (time < HORIZON) {
          const global = r.chance(0.25)
          this.sim.push(ref, 'unsubscribe', time, {
            source: r.chance(0.6) ? 'one-click' : 'link',
            listId: global ? null : listId,
            scope: global ? 'all' : 'list'
          })
          outcome.lastEventAt = Math.max(outcome.lastEventAt, time)

          if (global) this.unsubscribeEverywhere(contact, time, 'unsubscribe_link')
          else this.unsubscribeFromList(contact.row.id, listId, time)
        }
      }

      if (outcome.status === 'bounced' && contact.status === 'bounced')
        this.suppress(contact.row.email, 'hard_bounce', 'ses', outcome.lastEventAt)

      this.messages.push({
        id: messageId,
        kind: 'broadcast',
        broadcastId,
        contactId: contact.row.id,
        templateId: this.ids.templates.newsletter,
        topicId: plan.list === 'product' ? this.ids.topics.product : null,
        toEmail: contact.row.email,
        fromEmail: 'news@acme.test',
        subject: plan.subject,
        tags: {
          message_id: messageId,
          kind: 'broadcast',
          broadcast_id: broadcastId,
          contact_id: contact.row.id
        },
        status: outcome.status,
        providerMessageId: outcome.providerMessageId,
        error: outcome.error,
        sentAt: at(outcome.sentAt),
        deliveredAt: outcome.deliveredAt ? at(outcome.deliveredAt) : null,
        openedAt: outcome.openedAt ? at(outcome.openedAt) : null,
        clickedAt: outcome.clickedAt ? at(outcome.clickedAt) : null,
        openCount: outcome.openCount,
        clickCount: outcome.clickCount,
        createdAt: at(start - 5 * SECOND),
        updatedAt: at(outcome.lastEventAt)
      })
    })

    const completedAt = at(start + recipients.length * 72 + 2 * SECOND)

    return {
      id: broadcastId,
      name: plan.name,
      subject: plan.subject,
      preheader: plan.preheader,
      fromName: COMPANY.name,
      fromEmail: 'news@acme.test',
      replyTo: 'hello@acme.test',
      templateId: this.ids.templates.newsletter,
      topicId: plan.list === 'product' ? this.ids.topics.product : null,
      audience: { listIds: [listId], segmentIds: [], excludeListIds: [] },
      utm: { enabled: false },
      status: 'sent',
      startedAt: at(start),
      completedAt,
      recipientCount: recipients.length,
      htmlSnapshot: snapshot,
      createdAt: at(start - 2 * DAY),
      updatedAt: completedAt
    }
  }

  // Transactional & system -----------------------------------------------------
  private async render(
    layoutHtml: string,
    contact: SeedContact,
    data: Record<string, string>
  ): Promise<{ html: string; text: string }> {
    const vars = {
      company: COMPANY,
      contact: { first_name: contact.row.firstName, email: contact.row.email },
      data
    }

    const html = await this.liquid.parseAndRender(layoutHtml, vars)

    return {
      html,
      text: `${data.heading ?? ''}\n\n${data.body ?? ''}\n\n${data.cta_label ?? ''}: ${data.cta_url ?? ''}`
    }
  }

  /** Emails sent through the API (welcome, password resets, receipts, codes) and double opt-in confirmations. */
  private async transactionalSpecs(
    welcomeHtml: string,
    layoutHtml: string
  ): Promise<TransactionalSpec[]> {
    const r = this.r
    const existing = (time: number) => this.contacts.filter((c) => c.row.createdAt.getTime() < time)
    const randomTime = (fromDaysAgo: number) => NOW - r.between(HOUR, fromDaysAgo * DAY)
    const specs: TransactionalSpec[] = []

    for (const contact of this.contacts.filter((c) => c.row.createdAt.getTime() > NOW - 60 * DAY)) {
      if (!r.chance(0.26)) continue
      const plan = contact.plan

      const html = await this.liquid.parseAndRender(welcomeHtml, {
        company: COMPANY,
        contact: { first_name: contact.row.firstName, email: contact.row.email },
        data: { plan }
      })

      specs.push({
        kind: 'transactional',
        time: contact.row.createdAt.getTime() + r.between(3 * SECOND, 40 * SECOND),
        contact,
        subject: `Welcome to ${COMPANY.name}, ${contact.row.firstName ?? 'there'}`,
        category: 'onboarding',
        html,
        text: `Welcome aboard, ${contact.row.firstName ?? 'there'}.\n\nYour ${plan} account is ready.\n\nGetting started: https://acme.test/getting-started`,
        variables: { plan },
        templateId: this.ids.templates.welcome,
        idempotencyKey: `welcome-${contact.row.id}`,
        openRate: 0.62,
        clickRate: 0.22,
        links: [
          ['https://acme.test/getting-started', 4],
          ['https://acme.test/docs', 1]
        ]
      })
    }

    for (let i = 0; i < 60; i++) {
      const time = randomTime(60)
      const contact = r.pick(existing(time))
      const url = `https://app.acme.test/reset-password?token=${randomBytes(12).toString('hex')}`

      const { html, text } = await this.render(layoutHtml, contact, {
        heading: 'Reset your password',
        body: 'Use the button below to choose a new password. The link expires in 30 minutes.',
        cta_label: 'Reset password',
        cta_url: url
      })

      specs.push({
        kind: 'transactional',
        time,
        contact,
        subject: 'Reset your password',
        category: 'auth',
        html,
        text,
        variables: { reset_url: url },
        openRate: 0.75,
        clickRate: 0.55,
        links: [[url, 1]]
      })
    }

    const paying = this.contacts.filter((c) => c.plan !== 'free')

    for (let i = 0; i < 70; i++) {
      const time = randomTime(60)
      const candidates = paying.filter((c) => c.row.createdAt.getTime() < time)

      if (!candidates.length) continue
      const contact = r.pick(candidates)
      const invoice = `A-${10_240 + i}`

      const amount = PRICES[contact.plan]

      const { html, text } = await this.render(layoutHtml, contact, {
        heading: `Receipt ${invoice}`,
        body: `We received your payment of ${amount}. Thanks for being a customer.`,
        cta_label: 'View invoice',
        cta_url: 'https://app.acme.test/billing/invoices'
      })

      specs.push({
        kind: 'transactional',
        time,
        contact,
        subject: `Your receipt from ${COMPANY.name} #${invoice}`,
        category: 'billing',
        html,
        text,
        variables: { invoice, amount },
        idempotencyKey: `receipt-${invoice}`,
        openRate: 0.45,
        clickRate: 0.06,
        links: [['https://app.acme.test/billing/invoices', 1]]
      })
    }

    for (let i = 0; i < 40; i++) {
      const time = randomTime(60)
      const contact = r.pick(existing(time))
      const code = String(r.int(100_000, 999_999))

      const { html, text } = await this.render(layoutHtml, contact, {
        heading: `Your sign-in code is ${code}`,
        body: 'Enter this code to finish signing in. It expires in 10 minutes.',
        cta_label: 'Open the app',
        cta_url: 'https://app.acme.test/login'
      })

      specs.push({
        kind: 'transactional',
        time,
        contact,
        subject: `Your sign-in code is ${code}`,
        category: 'auth',
        html,
        text,
        variables: { code },
        openRate: 0.85,
        clickRate: 0,
        links: []
      })
    }

    for (const sub of this.subscriptions) {
      const createdAt = sub.row.createdAt

      if (
        sub.row.listId !== this.ids.lists.product ||
        !(createdAt instanceof Date) ||
        createdAt.getTime() < NOW - 60 * DAY ||
        !r.chance(0.35)
      )
        continue
      const contact = this.contacts.find((c) => c.row.id === sub.row.contactId)

      if (!contact) continue
      const confirmUrl = `http://localhost:3000/confirm/${randomBytes(16).toString('hex')}`

      const { html, text } = await this.render(layoutHtml, contact, {
        heading: 'Confirm your subscription',
        body: 'Please confirm that you want to receive Product updates from Acme.',
        cta_label: 'Confirm subscription',
        cta_url: confirmUrl
      })

      specs.push({
        kind: 'system',
        time: createdAt.getTime() + r.between(SECOND, 5 * SECOND),
        contact,
        subject: 'Confirm your subscription to Product updates',
        category: 'double_opt_in',
        html,
        text,
        variables: { list: 'Product updates (demo)' },
        openRate: sub.row.confirmedAt ? 0.95 : 0.4,
        clickRate: sub.row.confirmedAt ? 0.9 : 0,
        links: [[confirmUrl, 1]]
      })
    }

    return specs.filter((spec) => spec.time < HORIZON)
  }

  private sendTransactional(spec: TransactionalSpec): void {
    const messageId = uuidv7(spec.time)
    const contact = spec.contact
    const blocked = contact.blockedAt !== null && contact.blockedAt <= spec.time

    if (blocked && (contact.status === 'bounced' || contact.status === 'complained')) {
      const reason = contact.status === 'bounced' ? 'hard_bounce' : 'complaint'
      this.messages.push(
        this.transactionalRow(messageId, spec, null, {
          status: 'suppressed',
          error: `Suppressed: ${reason}`
        })
      )

      return
    }

    const outcome = this.sim.deliver({
      messageId,
      contact,
      toEmail: contact.row.email,
      broadcastId: null,
      sentAt: spec.time + this.r.between(300, 2500),
      openRate: spec.openRate,
      clickRate: spec.clickRate,
      hardBounce: 0.008,
      softBounce: 0.004,
      links: spec.links
    })

    if (outcome.status === 'bounced' && contact.status === 'bounced')
      this.suppress(contact.row.email, 'hard_bounce', 'ses', outcome.lastEventAt)
    this.messages.push(this.transactionalRow(messageId, spec, outcome))
  }

  private transactionalRow(
    messageId: string,
    spec: MessageSpec,
    outcome: DeliveryOutcome | null,
    overrides: Partial<MessageInsert> = {}
  ): MessageInsert {
    return {
      id: messageId,
      kind: spec.kind,
      contactId: spec.contact.row.id,
      templateId: spec.templateId ?? null,
      toEmail: spec.contact.row.email,
      fromEmail: spec.kind === 'system' ? 'lists@acme.test' : 'hello@acme.test',
      subject: spec.subject,
      html: spec.html,
      text: spec.text,
      variables: spec.variables,
      tags: {
        category: spec.category,
        message_id: messageId,
        kind: spec.kind,
        contact_id: spec.contact.row.id
      },
      idempotencyKey: spec.idempotencyKey ?? null,
      status: outcome?.status ?? 'queued',
      providerMessageId: outcome?.providerMessageId ?? null,
      error: outcome?.error ?? null,
      sentAt: outcome ? at(outcome.sentAt) : null,
      deliveredAt: outcome?.deliveredAt ? at(outcome.deliveredAt) : null,
      openedAt: outcome?.openedAt ? at(outcome.openedAt) : null,
      clickedAt: outcome?.clickedAt ? at(outcome.clickedAt) : null,
      openCount: outcome?.openCount ?? 0,
      clickCount: outcome?.clickCount ?? 0,
      createdAt: at(spec.time),
      updatedAt: at(outcome?.lastEventAt ?? spec.time),
      ...overrides
    }
  }

  /** Sends that failed before the domain was verified, and reminders scheduled for tomorrow. */
  private async addEdgeCases(layoutHtml: string): Promise<void> {
    const r = this.r

    const error =
      'Message rejected: Email address is not verified. The following identities failed the check in region US-EAST-1: hello@acme.test'

    for (const contact of r.sample(
      this.contacts.filter((c) => c.row.createdAt.getTime() < NOW - 60 * DAY),
      4
    )) {
      const time = NOW - r.between(57 * DAY, 59 * DAY)
      const messageId = uuidv7(time)

      const content = await this.render(layoutHtml, contact, {
        heading: 'Your trial has started',
        body: 'You have 14 days to try every feature.',
        cta_label: 'Open the app',
        cta_url: 'https://app.acme.test'
      })

      const spec: MessageSpec = {
        kind: 'transactional',
        time,
        contact,
        subject: 'Your trial has started',
        category: 'onboarding',
        variables: {},
        ...content
      }

      this.messages.push(
        this.transactionalRow(messageId, spec, null, {
          status: 'failed',
          error,
          updatedAt: at(time + SECOND)
        })
      )
      this.sim.push({ messageId, contact, broadcastId: null }, 'failed', time + SECOND, { error })
    }

    for (const contact of r.sample(
      this.contacts.filter((c) => c.status === 'active'),
      2
    )) {
      const time = NOW - r.between(HOUR, 3 * HOUR)

      const content = await this.render(layoutHtml, contact, {
        heading: 'Your trial ends in 3 days',
        body: 'Pick a plan to keep your dashboards and workflows running.',
        cta_label: 'Choose a plan',
        cta_url: 'https://acme.test/pricing'
      })

      const spec: MessageSpec = {
        kind: 'transactional',
        time,
        contact,
        subject: 'Your trial ends in 3 days',
        category: 'billing',
        variables: {},
        ...content
      }

      this.messages.push(
        this.transactionalRow(uuidv7(time), spec, null, {
          status: 'scheduled',
          scheduledAt: at(NOW + r.between(18 * HOUR, 40 * HOUR))
        })
      )
    }
  }

  // Observability ----------------------------------------------------------------
  /**
   * SNS notifications as the processor stores them: notifications whose SES tags
   * name the organization belong to it; the topic subscription confirmation is
   * instance-level (no organization) and never shown to organization members.
   */
  private buildInboundEvents(): InboundInsert[] {
    const r = this.r
    const organizationId = this.scope.organizationId
    const topicArn = 'arn:aws:sns:us-east-1:123456789012:mlist-ses-events'

    const sesName: Partial<Record<EventInsert['type'], { name: string; key: string }>> = {
      delivery: { name: 'Delivery', key: 'delivery' },
      bounce: { name: 'Bounce', key: 'bounce' },
      complaint: { name: 'Complaint', key: 'complaint' },
      open: { name: 'Open', key: 'open' },
      click: { name: 'Click', key: 'click' }
    }

    const byId = new Map(this.messages.map((m) => [m.id, m]))

    const envelope = (messageId: string, message: JsonObject, time: number) => ({
      Type: 'Notification',
      MessageId: messageId,
      TopicArn: topicArn,
      Message: JSON.stringify(message),
      Timestamp: at(time).toISOString(),
      SignatureVersion: '1',
      Signature: 'EXAMPLE-signature-redacted',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-example.pem',
      UnsubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=${topicArn}:example`
    })

    const recent = this.sim.events
      .filter(
        (e) =>
          sesName[e.type] && e.occurredAt instanceof Date && e.occurredAt.getTime() > NOW - 3 * DAY
      )
      .sort(
        (a, b) =>
          (b.occurredAt instanceof Date ? b.occurredAt.getTime() : 0) -
          (a.occurredAt instanceof Date ? a.occurredAt.getTime() : 0)
      )
      .slice(0, 150)

    const rows: InboundInsert[] = recent.flatMap((event) => {
      const kind = sesName[event.type]
      const message = event.messageId ? byId.get(event.messageId) : undefined

      if (!kind || !message || !(event.occurredAt instanceof Date)) return []
      const time = event.occurredAt.getTime() + r.between(SECOND, 15 * SECOND)

      const tags = {
        message_id: [String(message.id)],
        organization_id: [organizationId],
        kind: [message.kind],
        broadcast_id: message.broadcastId ? [message.broadcastId] : undefined
      }

      const sesEvent = {
        eventType: kind.name,
        mail: {
          timestamp:
            message.sentAt instanceof Date ? message.sentAt.toISOString() : at(time).toISOString(),
          messageId: message.providerMessageId,
          source: message.fromEmail,
          destination: [message.toEmail],
          tags
        },
        [kind.key]: event.data
      }

      const snsId = randomUUID()

      return [
        this.scope.values({
          snsMessageId: snsId,
          type: 'Notification',
          eventType: kind.name,
          topicArn,
          payload: envelope(snsId, sesEvent, time),
          status: 'processed' as const,
          createdAt: at(time)
        })
      ]
    })

    const subscriptionId = randomUUID()
    rows.push({
      snsMessageId: subscriptionId,
      type: 'SubscriptionConfirmation',
      eventType: null,
      topicArn,
      payload: {
        Type: 'SubscriptionConfirmation',
        MessageId: subscriptionId,
        TopicArn: topicArn,
        Message: `You have chosen to subscribe to the topic ${topicArn}.`,
        SubscribeURL:
          'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=example',
        Timestamp: at(NOW - 60 * DAY).toISOString()
      },
      status: 'processed',
      createdAt: at(NOW - 60 * DAY)
    })

    for (let i = 0; i < 3; i++) {
      const time = NOW - r.between(HOUR, 2 * DAY)
      const snsId = randomUUID()

      const sesEvent = {
        eventType: 'Delivery',
        mail: {
          timestamp: at(time).toISOString(),
          messageId: sesMessageId(),
          source: 'billing@acme.test',
          destination: ['finance@globex.example'],
          tags: { organization_id: [organizationId] }
        },
        delivery: { recipients: ['finance@globex.example'], smtpResponse: '250 OK' }
      }

      rows.push(
        this.scope.values({
          snsMessageId: snsId,
          type: 'Notification',
          eventType: 'Delivery',
          topicArn,
          payload: envelope(snsId, sesEvent, time),
          status: 'ignored' as const,
          error: 'No message matches this SES message id (sent outside mlist)',
          createdAt: at(time)
        })
      )
    }

    const failedId = randomUUID()
    const failedTime = NOW - r.between(5 * DAY, 6 * DAY)
    rows.push(
      this.scope.values({
        snsMessageId: failedId,
        type: 'Notification',
        eventType: 'Bounce',
        topicArn,
        payload: envelope(
          failedId,
          {
            eventType: 'Bounce',
            mail: {
              timestamp: at(failedTime).toISOString(),
              messageId: sesMessageId(),
              destination: [],
              tags: { organization_id: [organizationId] }
            },
            bounce: { bounceSubType: 'General' }
          },
          failedTime
        ),
        status: 'failed' as const,
        error:
          'Invalid Bounce event: bounce.bounceType Invalid option: expected one of "Undetermined"|"Permanent"|"Transient"',
        createdAt: at(failedTime)
      })
    )

    return rows
  }

  private buildApiLogs(): ApiLogInsert[] {
    const r = this.r
    const logs: ApiLogInsert[] = []

    const client = () =>
      r.weighted([
        ['mlist-node/1.4.0', 6],
        ['python-requests/2.32.3', 2],
        ['curl/8.7.1', 1]
      ] as const)

    const ip = '203.0.113.10'

    for (const message of this.messages.filter(
      (m) =>
        m.kind === 'transactional' &&
        m.createdAt instanceof Date &&
        m.createdAt.getTime() > NOW - 30 * DAY
    )) {
      if (!(message.createdAt instanceof Date)) continue
      const template = message.templateId ? 'welcome' : undefined
      logs.push({
        method: 'POST',
        path: '/api/v1/emails',
        statusCode: 200,
        durationMs: r.int(38, 190),
        ip,
        userAgent: client(),
        requestBody: template
          ? { to: message.toEmail, template, data: message.variables ?? {} }
          : {
              to: message.toEmail,
              subject: message.subject,
              html: '<!-- 4.1 KB -->',
              tags: { category: (message.tags ?? {}).category }
            },
        responseBody: { id: message.id, status: 'queued' },
        createdAt: at(message.createdAt.getTime() - r.between(30, 120))
      })

      if (r.chance(0.12)) {
        logs.push({
          method: 'GET',
          path: `/api/v1/emails/${message.id}`,
          statusCode: 200,
          durationMs: r.int(12, 60),
          ip,
          userAgent: client(),
          requestBody: null,
          responseBody: {
            id: message.id,
            to: message.toEmail,
            status: message.status,
            subject: message.subject
          },
          createdAt: at(message.createdAt.getTime() + r.between(5 * MINUTE, 3 * HOUR))
        })
      }
    }

    for (const contact of this.contacts.filter(
      (c) => c.row.source === 'api' && c.row.createdAt.getTime() > NOW - 30 * DAY
    )) {
      logs.push({
        method: 'POST',
        path: '/api/v1/contacts',
        statusCode: 201,
        durationMs: r.int(45, 210),
        ip,
        userAgent: client(),
        requestBody: {
          email: contact.row.email,
          firstName: contact.row.firstName,
          attributes: contact.row.attributes,
          lists: [this.ids.lists.newsletter]
        },
        responseBody: { id: contact.row.id, email: contact.row.email, status: 'active' },
        createdAt: at(contact.row.createdAt.getTime() - r.between(20, 90))
      })
    }

    const errors: [number, number, string, string, unknown, unknown][] = [
      [
        14,
        422,
        'POST',
        '/api/v1/emails',
        { to: 'not-an-email', template: 'welcome' },
        { error: { code: 'validation_error', message: 'to: Invalid email address' } }
      ],
      [
        5,
        422,
        'POST',
        '/api/v1/contacts',
        { email: '' },
        { error: { code: 'validation_error', message: 'email: Invalid email address' } }
      ],
      [
        6,
        401,
        'POST',
        '/api/v1/emails',
        null,
        { error: { code: 'unauthorized', message: 'Missing or invalid API key' } }
      ],
      [
        4,
        429,
        'POST',
        '/api/v1/emails',
        null,
        { error: { code: 'rate_limited', message: 'Too many requests', retryAfter: 12 } }
      ],
      [
        3,
        404,
        'GET',
        '/api/v1/contacts/01a1c0da-0000-7000-8000-000000000000',
        null,
        { error: { code: 'not_found', message: 'Contact not found' } }
      ],
      [
        1,
        500,
        'POST',
        '/api/v1/emails',
        { to: 'ops@initech.example', template: 'welcome' },
        { error: { code: 'internal_error', message: 'Something went wrong' } }
      ]
    ]

    for (const [times, statusCode, method, path, requestBody, responseBody] of errors) {
      for (let i = 0; i < times; i++) {
        logs.push({
          method,
          path,
          statusCode,
          durationMs: statusCode === 500 ? r.int(900, 1400) : r.int(4, 40),
          ip: statusCode === 401 ? `198.51.100.${r.int(2, 254)}` : ip,
          userAgent: client(),
          requestBody,
          responseBody,
          createdAt: at(NOW - r.between(10 * MINUTE, 30 * DAY))
        })
      }
    }

    return logs.sort(
      (a, b) =>
        (a.createdAt instanceof Date ? a.createdAt.getTime() : 0) -
        (b.createdAt instanceof Date ? b.createdAt.getTime() : 0)
    )
  }

  private buildAuditLog(broadcasts: BroadcastInsert[]): AuditInsert[] {
    const { admin, organization, membership } = this.workspace

    const user = {
      actorType: 'user' as const,
      actorId: admin.id,
      actorLabel: admin.email,
      ip: '127.0.0.1',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }

    const system = {
      actorType: 'system' as const,
      actorId: null,
      actorLabel: 'System',
      ip: null,
      userAgent: null
    }

    const entries: AuditInsert[] = [
      {
        ...user,
        action: 'organization.created',
        entityType: 'organization',
        entityId: organization.id,
        summary: `Created the organization ${organization.name}`,
        changes: { name: organization.name, slug: organization.slug },
        createdAt: at(NOW - 90 * DAY)
      },
      {
        ...user,
        action: 'member.added',
        entityType: 'member',
        entityId: membership.id,
        summary: `Added ${admin.email} as ${roleLabel(membership.role)}`,
        changes: { userId: admin.id, email: admin.email, role: membership.role },
        createdAt: at(NOW - 90 * DAY + SECOND)
      },
      {
        ...user,
        action: 'settings.updated',
        entityType: 'settings',
        entityId: 'sending',
        summary: 'Updated sending settings',
        changes: { provider: { from: 'smtp', to: 'ses' }, ratePerSecond: { from: 14, to: 10 } },
        createdAt: at(NOW - 89.5 * DAY)
      },
      {
        ...user,
        action: 'list.created',
        entityType: 'list',
        entityId: this.ids.lists.newsletter,
        summary: `Created list "${SEED_MARKER}"`,
        createdAt: at(NOW - 89 * DAY)
      },
      {
        ...user,
        action: 'list.created',
        entityType: 'list',
        entityId: this.ids.lists.product,
        summary: 'Created list "Product updates (demo)"',
        createdAt: at(NOW - 89 * DAY + MINUTE)
      },
      {
        ...user,
        action: 'topic.created',
        entityType: 'topic',
        entityId: this.ids.topics.product,
        summary: 'Created topic "Product news"',
        createdAt: at(NOW - 89 * DAY + 2 * MINUTE)
      },
      {
        ...user,
        action: 'topic.created',
        entityType: 'topic',
        entityId: this.ids.topics.events,
        summary: 'Created topic "Events & webinars"',
        createdAt: at(NOW - 89 * DAY + 3 * MINUTE)
      },
      {
        ...user,
        action: 'import.completed',
        entityType: 'import',
        entityId: null,
        summary: 'Imported 150 contacts from customers.csv',
        changes: { created: { from: null, to: 150 }, skipped: { from: null, to: 0 } },
        createdAt: at(NOW - 88 * DAY)
      },
      {
        ...user,
        action: 'list.created',
        entityType: 'list',
        entityId: this.ids.lists.beta,
        summary: 'Created list "Beta testers (demo)"',
        createdAt: at(NOW - 80 * DAY)
      },
      {
        ...user,
        action: 'template.created',
        entityType: 'template',
        entityId: this.ids.templates.welcome,
        summary: 'Created template "Welcome email"',
        createdAt: at(NOW - 75 * DAY)
      },
      {
        ...user,
        action: 'template.created',
        entityType: 'template',
        entityId: this.ids.templates.newsletter,
        summary: 'Created template "Monthly newsletter"',
        createdAt: at(NOW - 70 * DAY)
      },
      {
        ...user,
        action: 'suppression.created',
        entityType: 'suppression',
        entityId: 'abuse@globex.example',
        summary: 'Suppressed abuse@globex.example',
        createdAt: at(NOW - 61 * DAY)
      },
      {
        ...user,
        action: 'suppression.created',
        entityType: 'suppression',
        entityId: 'postmaster@initech.example',
        summary: 'Suppressed postmaster@initech.example',
        createdAt: at(NOW - 33 * DAY)
      },
      {
        ...user,
        action: 'template.updated',
        entityType: 'template',
        entityId: this.ids.templates.newsletter,
        summary: 'Updated template "Monthly newsletter"',
        changes: {
          subject: { from: 'Monthly update', to: 'News from {{ company.name }}' },
          preheader: { from: null, to: 'What shipped this month' }
        },
        createdAt: at(NOW - 5 * DAY)
      },
      {
        ...user,
        action: 'suppression.created',
        entityType: 'suppression',
        entityId: 'legal@hooli.example',
        summary: 'Suppressed legal@hooli.example',
        createdAt: at(NOW - 9 * DAY)
      }
    ]

    for (const b of broadcasts) {
      const started = b.startedAt instanceof Date ? b.startedAt.getTime() : NOW
      entries.push(
        {
          ...user,
          action: 'broadcast.created',
          entityType: 'broadcast',
          entityId: b.id,
          summary: `Created broadcast "${b.name}"`,
          createdAt: at(started - 2 * DAY)
        },
        {
          ...user,
          action: 'broadcast.sent',
          entityType: 'broadcast',
          entityId: b.id,
          summary: `Started sending "${b.name}" to ${b.recipientCount} contacts`,
          changes: { status: { from: 'draft', to: 'sending' } },
          createdAt: at(started - SECOND)
        },
        {
          ...system,
          action: 'broadcast.completed',
          entityType: 'broadcast',
          entityId: b.id,
          summary: `Finished sending "${b.name}"`,
          changes: { status: { from: 'sending', to: 'sent' } },
          createdAt: b.completedAt instanceof Date ? b.completedAt : at(started)
        }
      )
    }

    return entries.sort(
      (a, b) =>
        (a.createdAt instanceof Date ? a.createdAt.getTime() : 0) -
        (b.createdAt instanceof Date ? b.createdAt.getTime() : 0)
    )
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // No .env file: fall back to the defaults in loadAppConfig().
  }

  const { db, pool } = createDatabase(loadAppConfig().databaseUrl, 4)

  try {
    const workspace = await new WorkspaceSeeder(db).ensure()
    await new DemoSeeder(db, workspace).run()
  } finally {
    await pool.end()
  }
}

// A rejection exits with a non-zero code and prints the error.
await main()
