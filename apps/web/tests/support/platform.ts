import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { createDatabase, schema } from '../../server/db/client'
import type { Database, DatabaseHandle } from '../../server/db/client'
import type { Actor } from '../../server/lib/core/actor'
import { Container } from '../../server/lib/core/Container'
import type { AppConfig } from '../../server/lib/core/Container'
import { RecordingJobLauncher } from '../../server/lib/core/jobs'
import type { OrganizationContainer } from '../../server/lib/core/OrganizationContainer'
import type { ContactRow } from '../../server/lib/contacts/ContactService'
import type { ImportDetail } from '../../shared/types/contacts'
import type { ListRow } from '../../server/lib/lists/ListService'
import type { TemplateRow } from '../../server/lib/templates/TemplateService'
import { broadcastCreateSchema } from '../../shared/schemas/broadcasts'
import { contactCreateSchema } from '../../shared/schemas/contacts'
import type { ContactCreateInput } from '../../shared/schemas/contacts'
import { importCreateSchema } from '../../shared/schemas/imports'
import type { ImportCreateInput } from '../../shared/schemas/imports'
import { listInputSchema } from '../../shared/schemas/lists'
import { templateCreateSchema } from '../../shared/schemas/templates'
import { transactionalEmailSchema } from '../../shared/schemas/transactional'
import type { DeliveryResult } from '../../server/lib/transactional/TransactionalService'
import type { LimitSettings } from '../../shared/types/domain'
import { TEST_DATABASE_URL } from './database'
import { RecordingEmailProvider } from './RecordingEmailProvider'

/** What a broadcast is created with (the composer's request body). */
export type BroadcastDraft = z.input<typeof broadcastCreateSchema>

/** Public base URL of recipient links in tests. */
export const TEST_APP_URL = 'http://nulist.test'

/** Instance-wide secrets and defaults of the test platform (never the dev ones). */
const TEST_CONFIG: AppConfig = {
  databaseUrl: TEST_DATABASE_URL,
  appSecret: 'test-only-secret-test-only-secret-test-only-secret',
  appUrl: TEST_APP_URL,
  snsTopicArns: [],
  organizationCacheSize: 100,
  // Webhook receivers of the tests listen on localhost.
  outbound: { allowPrivateNetworks: true },
  defaults: {
    smtpHost: 'smtp.instance.test',
    smtpPort: 2525,
    s3Endpoint: 'https://s3.instance.test',
    s3Region: 'us-east-1',
    s3Bucket: 'nulist-test',
    s3AccessKeyId: 'instance-key',
    s3SecretAccessKey: 'instance-secret',
    s3PublicUrl: 'https://cdn.instance.test',
    limits: {}
  }
}

/** The token at the end of a recipient link (`…/u/<token>`, `…/confirm/<token>`). */
export function tokenOf(url: string): string {
  const token = new URL(url).pathname.split('/').at(-1)

  if (!token) throw new Error(`No token in ${url}`)

  return token
}

/** The first link in an email body pointing at `path` (e.g. `/confirm/`). */
export function linkIn(html: string, path: string): string {
  const pattern = new RegExp(`${TEST_APP_URL}${path}[\\w.-]+`)
  const match = pattern.exec(html)

  if (!match) throw new Error(`No ${path} link in the email`)

  return match[0]
}

/**
 * One organization of the test platform: its real tenant services (as
 * `Container.forOrganization` builds them) and the actor of its writes, plus
 * the steps the durable workflows would run, driven inline.
 */
export class TestOrganization {
  readonly services: OrganizationContainer
  readonly actor: Actor

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly platform: TestPlatform
  ) {
    this.services = platform.container.forOrganization(id)
    this.actor = { type: 'system', id: null, label: `${name} admin`, organizationId: id }
  }

  async list(name: string, optIn: 'single' | 'double' = 'single'): Promise<ListRow> {
    return this.services.lists.create(listInputSchema.parse({ name, optIn }), this.actor)
  }

  async contact(input: ContactCreateInput): Promise<ContactRow> {
    return this.services.contacts.create(contactCreateSchema.parse(input), this.actor)
  }

  /** A marketing template built from the default starter (it has the unsubscribe link). */
  async newsletterTemplate(): Promise<TemplateRow> {
    const input = templateCreateSchema.parse({ name: 'Newsletter', editor: 'code' })

    return this.services.templates.create(input, this.actor)
  }

  /** Instance administrator action: changes some of this organization's quotas. */
  async setLimits(changes: Partial<LimitSettings>): Promise<void> {
    const current = await this.services.settings.get('limits')
    const admin: Actor = { type: 'system', id: null, label: 'Instance admin', organizationId: null }

    await this.platform.container.organizations.updateLimits(
      this.id,
      { ...current, ...changes },
      admin
    )
  }

  /** Accepts a transactional email (as POST /api/v1/emails does) and runs its delivery step. */
  async deliverEmail(to: string): Promise<DeliveryResult> {
    const { transactional } = this.services

    const { email } = await transactional.send(
      transactionalEmailSchema.parse({ to, subject: 'Your receipt', html: '<p>Thanks!</p>' }),
      null
    )

    return transactional.deliver(email.id)
  }

  /** Creates and schedules a broadcast, then runs the send workflow's steps to completion. */
  async sendBroadcast(input: BroadcastDraft): Promise<string> {
    const { broadcasts } = this.services
    const template = await this.newsletterTemplate()

    const broadcast = await broadcasts.create(
      broadcastCreateSchema.parse({ subject: 'News', templateId: template.id, ...input }),
      this.actor
    )

    await broadcasts.schedule(broadcast.id, null, this.actor)
    await broadcasts.begin(broadcast.id)

    for (let batch = 0; batch < 20; batch++) {
      const result = await broadcasts.sendBatch(broadcast.id, 100)

      if (result.state === 'done') {
        await broadcasts.complete(broadcast.id)

        return broadcast.id
      }
    }

    throw new Error('The broadcast did not finish sending')
  }

  /** Recipient emails of a broadcast (one message each), sorted. */
  async recipientsOf(broadcastId: string): Promise<string[]> {
    const page = await this.services.broadcasts.recipients(broadcastId, { page: 1, pageSize: 200 })

    return page.items.map((item) => item.email).toSorted()
  }

  /** Uploads a CSV and runs the import workflow's steps (stage → chunks → finalize). */
  async importCsv(input: ImportCreateInput): Promise<ImportDetail> {
    const { imports } = this.services
    const started = await imports.create(importCreateSchema.parse(input), this.actor)

    await imports.stage(started.id)
    let afterRow = 0

    for (;;) {
      const chunk = await imports.processChunk(started.id, afterRow, 3)
      afterRow = chunk.lastRow

      if (chunk.done) break
    }

    await imports.finalize(started.id, null)

    return imports.get(started.id)
  }
}

/**
 * The application's composition root (`Container`) wired to the test database,
 * with fakes only at the I/O edges: the mail transport and the workflow launcher.
 */
export class TestPlatform {
  readonly jobs = new RecordingJobLauncher()
  readonly mail = new RecordingEmailProvider()
  readonly container: Container
  private readonly handle: DatabaseHandle

  constructor() {
    this.handle = createDatabase(TEST_DATABASE_URL, 5)
    this.container = new Container(TEST_CONFIG, {
      db: this.handle.db,
      jobs: this.jobs,
      providers: { email: this.mail }
    })
  }

  /** Direct database access for fixtures and assertions on stored rows. */
  get db(): Database {
    return this.handle.db
  }

  /** A new organization (as Better Auth creates it) with its settings seeded. */
  async organization(name: string): Promise<TestOrganization> {
    const [row] = await this.db
      .insert(schema.organization)
      .values({ name, slug: `org-${randomUUID()}`, createdAt: new Date() })
      .returning({ id: schema.organization.id })

    if (!row) throw new Error('Could not create the organization')
    await this.container.organizations.initialize(row.id, name)

    return new TestOrganization(row.id, name, this)
  }

  /** Workflow jobs launched for `job` so far. */
  launched(job: RecordingJobLauncher['launched'][number]['job']) {
    return this.jobs.launched.filter((entry) => entry.job === job)
  }

  async dispose(): Promise<void> {
    this.container.evictOrganization()
    await this.handle.pool.end()
  }
}
