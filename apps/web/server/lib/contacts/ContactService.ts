import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import {
  contacts,
  contactTopics,
  emailEvents,
  listSubscriptions,
  lists,
  messages,
  topics
} from '../../db/schema'
import { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import { Page } from '../core/pagination'
import type { LimitService } from '../limits/LimitService'
import type { ContactVariables } from '../templates/TemplateRenderer'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import { SuppressionService } from './SuppressionService'
import type {
  ContactBulkInput,
  ContactCreateData,
  ContactListQuery,
  ContactUpdateData
} from '../../../shared/schemas/contacts'
import type {
  BulkActionResult,
  ContactActivityItem,
  ContactDetail,
  ContactListItem
} from '../../../shared/types/contacts'
import type {
  ContactStatus,
  JsonObject,
  Paginated,
  SuppressionReason
} from '../../../shared/types/domain'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import { ContactActivityReader } from './ContactActivityReader'
import { ContactExporter } from './ContactExporter'
import { ContactFilter } from './ContactFilter'
import type { ContactFilterInput } from './ContactFilter'
import { SubscriptionWriter } from './SubscriptionWriter'
import type { TenantScope } from '../core/TenantScope'

export type ContactRow = typeof contacts.$inferSelect

export interface ContactUpsertInput {
  email: string
  firstName?: string | null
  lastName?: string | null
  attributes?: JsonObject
  source?: string | null
  consentIp?: string | null
}

export type SubscribeResult = 'confirmed' | 'unconfirmed' | 'already_subscribed'

/** Public webhook representation of a contact. */
export interface ContactPayload {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  attributes: JsonObject
  source: string | null
  createdAt: string
  updatedAt: string
}

/** Webhook payload of `contact.deleted`. */
export interface ContactDeletedPayload {
  id: string
  email: string
}

/** Webhook payload of `contact.subscribed` and `contact.unsubscribed`. */
export interface ContactSubscriptionPayload {
  id: string
  email: string | undefined
  /** Null for a global unsubscribe. */
  listId: string | null
  listName: string | null
  source?: string
}

export type ContactWebhookPayload =
  | ContactPayload
  | ContactDeletedPayload
  | ContactSubscriptionPayload

export interface SubscribeOptions {
  /** Confirm immediately on double opt-in lists (the caller vouches for consent). */
  skipOptIn?: boolean
  /** Explicit admin action: allows re-subscribing a member who unsubscribed from the list. */
  resubscribe?: boolean
}

/** Contact status implied by an existing suppression when the contact is (re)created. */
const SUPPRESSION_STATUS: Record<SuppressionReason, ContactStatus | null> = {
  hard_bounce: 'bounced',
  complaint: 'complained',
  unsubscribe: 'unsubscribed',
  manual: 'blocklisted',
  soft_bounce: null
}

/** Suppressions that are stronger than an unsubscribe and must never be downgraded. */
const HARD_SUPPRESSIONS: ReadonlySet<SuppressionReason> = new Set<SuppressionReason>([
  'hard_bounce',
  'complaint',
  'manual'
])

/** "1 contact", "12 contacts" for audit summaries. */
function contactCount(value: number): string {
  return `${value} contact${value === 1 ? '' : 's'}`
}

/**
 * The organization's audience: contacts, their list memberships and consent state.
 * Every query is limited to the scope's organization (another organization's
 * ids behave as not found). Every mutation is audited and announced through
 * the organization's outbound webhooks.
 */
export class ContactService {
  private readonly activityReader: ContactActivityReader
  private readonly exporter: ContactExporter

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly audit: AuditLogger,
    protected readonly limits: LimitService,
    protected readonly webhooks: WebhookDispatcher,
    protected readonly jobs: JobLauncher,
    protected readonly suppressions: SuppressionService
  ) {
    this.activityReader = new ContactActivityReader(scope, db)
    this.exporter = new ContactExporter(scope, db)
  }

  static normalizeEmail(email: string): string {
    return SuppressionService.normalize(email)
  }

  /** Contact status implied by a suppression reason (null = stays active). */
  static statusForSuppression(reason: SuppressionReason): ContactStatus | null {
    return SUPPRESSION_STATUS[reason]
  }

  /** Public webhook representation of a contact. */
  static toPayload(contact: ContactRow): ContactPayload {
    return {
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      status: contact.status,
      attributes: contact.attributes,
      source: contact.source,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString()
    }
  }

  /** Webhook delivery must never break the mutation that triggered it. */
  protected async notify(type: WebhookEventType, data: ContactWebhookPayload): Promise<void> {
    try {
      await this.webhooks.dispatch(type, data)
    } catch (error) {
      console.error(`[contacts] failed to dispatch ${type} webhook`, error)
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  async list(query: ContactListQuery): Promise<Paginated<ContactListItem>> {
    const page = Page.from(query)
    const where = new ContactFilter(this.scope, query).where()
    const listCount = sql<number>`(select count(*)::int from ${listSubscriptions} where ${listSubscriptions.contactId} = ${contacts.id} and ${listSubscriptions.status} <> 'unsubscribed')`

    const [items, [total]] = await Promise.all([
      this.db
        .select({
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          status: contacts.status,
          source: contacts.source,
          listCount,
          lastOpenedAt: contacts.lastOpenedAt,
          createdAt: contacts.createdAt
        })
        .from(contacts)
        .where(where)
        .orderBy(...ContactFilter.orderBy(query.sort))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(contacts).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  /** A contact of the organization (another organization's id → NotFoundError). */
  async findOrFail(id: string): Promise<ContactRow> {
    const [row] = await this.db
      .select()
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, id)))

    if (!row) throw new NotFoundError('Contact', id)

    return row
  }

  /** Emails are unique per organization: the same address may exist in another one. */
  async findByEmail(email: string): Promise<ContactRow | null> {
    const [row] = await this.db
      .select()
      .from(contacts)
      .where(
        and(
          this.scope.eq(contacts.organizationId),
          eq(contacts.email, ContactService.normalizeEmail(email))
        )
      )

    return row ?? null
  }

  async get(id: string): Promise<ContactDetail> {
    const contact = await this.findOrFail(id)

    const [subscriptions, topicRows, [stats], suppression] = await Promise.all([
      this.db
        .select({
          listId: lists.id,
          listName: lists.name,
          optIn: lists.optIn,
          status: listSubscriptions.status,
          createdAt: listSubscriptions.createdAt,
          confirmedAt: listSubscriptions.confirmedAt,
          unsubscribedAt: listSubscriptions.unsubscribedAt
        })
        .from(listSubscriptions)
        .innerJoin(lists, eq(lists.id, listSubscriptions.listId))
        .where(and(this.scope.eq(lists.organizationId), eq(listSubscriptions.contactId, id)))
        .orderBy(lists.name),
      this.db
        .select({
          topicId: topics.id,
          name: topics.name,
          description: topics.description,
          defaultSubscribed: topics.defaultSubscribed,
          subscribed: contactTopics.subscribed
        })
        .from(topics)
        .leftJoin(
          contactTopics,
          and(eq(contactTopics.topicId, topics.id), eq(contactTopics.contactId, id))
        )
        .where(this.scope.eq(topics.organizationId))
        .orderBy(topics.name),
      this.db
        .select({
          messages: sql<number>`count(*)::int`,
          delivered: sql<number>`count(${messages.deliveredAt})::int`,
          opened: sql<number>`(count(*) filter (where ${messages.openedAt} is not null or ${messages.clickedAt} is not null))::int`,
          clicked: sql<number>`count(${messages.clickedAt})::int`,
          bounced: sql<number>`(count(*) filter (where ${messages.status} = 'bounced'))::int`
        })
        .from(messages)
        .where(and(this.scope.eq(messages.organizationId), eq(messages.contactId, id))),
      this.suppressions.find(contact.email)
    ])

    return {
      ...contact,
      subscriptions,
      topics: topicRows.map((t) => ({
        topicId: t.topicId,
        name: t.name,
        description: t.description,
        subscribed: t.subscribed ?? t.defaultSubscribed,
        explicit: t.subscribed !== null
      })),
      stats: stats ?? { messages: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 },
      suppression: suppression
        ? {
            reason: suppression.reason,
            source: suppression.source,
            createdAt: suppression.createdAt
          }
        : null
    }
  }

  async activity(id: string, limit = 100): Promise<ContactActivityItem[]> {
    await this.findOrFail(id)

    return this.activityReader.read(id, limit)
  }

  /** Streams matching contacts as CSV (header + batches). The export itself is audited. */
  async exportCsv(filter: ContactFilterInput, actor: Actor): Promise<AsyncGenerator<string>> {
    const total = await this.exporter.count(filter)
    await this.audit.log(actor, {
      action: 'contact.exported',
      entityType: 'contact',
      summary: `Exported ${total} contact${total === 1 ? '' : 's'} to CSV`,
      changes: { filter: { ...filter, ids: filter.ids?.length } }
    })

    return this.exporter.stream(filter)
  }

  // ---------------------------------------------------------------------------
  // Create / update / delete
  // ---------------------------------------------------------------------------
  /** Dashboard/API creation: fails when the email already exists. */
  async create(input: ContactCreateData, actor: Actor): Promise<ContactRow> {
    const email = ContactService.normalizeEmail(input.email)

    if (await this.findByEmail(email))
      throw new ConflictError(`A contact with the email ${email} already exists`, 'contact_exists')
    await this.limits.assertCanCreate('contacts')

    const listIds = [...new Set(input.listIds ?? [])]

    if (listIds.length) {
      const found = await this.db
        .select({ id: lists.id })
        .from(lists)
        .where(and(this.scope.eq(lists.organizationId), inArray(lists.id, listIds)))

      if (found.length !== listIds.length) throw new NotFoundError('List')
    }

    const status = await this.initialStatus(email)

    const [contact] = await this.db
      .insert(contacts)
      .values(
        this.scope.values({
          email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          attributes: ContactService.cleanAttributes(input.attributes ?? {}),
          status,
          source: actor.type === 'api_key' ? 'api' : 'dashboard'
        })
      )
      .onConflictDoNothing({ target: [contacts.organizationId, contacts.email] })
      .returning()

    if (!contact)
      throw new ConflictError(`A contact with the email ${email} already exists`, 'contact_exists')

    await this.audit.log(actor, {
      action: 'contact.created',
      entityType: 'contact',
      entityId: contact.id,
      summary: `Created contact ${email}`
    })
    await this.notify('contact.created', ContactService.toPayload(contact))

    for (const listId of listIds) {
      if (contact.status !== 'active') break
      await this.subscribe(contact.id, listId, actor, { skipOptIn: input.skipOptIn })
    }

    return contact
  }

  /** Create or update by normalized email. Never re-activates unsubscribed/bounced/complained contacts. */
  async upsert(
    input: ContactUpsertInput,
    actor: Actor,
    tx?: Executor
  ): Promise<{ contact: ContactRow; created: boolean }> {
    const db = tx ?? this.db
    const email = ContactService.normalizeEmail(input.email)

    if (!email) throw new ValidationError('Email is required')
    const byEmail = and(this.scope.eq(contacts.organizationId), eq(contacts.email, email))
    const [existing] = await db.select().from(contacts).where(byEmail)

    if (existing) {
      const patch: Partial<typeof contacts.$inferInsert> = {}

      if (input.firstName !== undefined) patch.firstName = input.firstName

      if (input.lastName !== undefined) patch.lastName = input.lastName

      if (input.attributes)
        patch.attributes = ContactService.cleanAttributes({
          ...existing.attributes,
          ...input.attributes
        })

      if (input.consentIp) patch.consentIp = input.consentIp

      if (!existing.source && input.source) patch.source = input.source
      const changes = AuditLogger.diff(existing, { ...existing, ...patch })

      if (!Object.keys(changes).length) return { contact: existing, created: false }

      const [contact] = await db
        .update(contacts)
        .set(patch)
        .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, existing.id)))
        .returning()

      await this.audit.log(
        actor,
        {
          action: 'contact.updated',
          entityType: 'contact',
          entityId: existing.id,
          summary: `Updated contact ${email}`,
          changes
        },
        db
      )
      await this.notify('contact.updated', ContactService.toPayload(contact!))

      return { contact: contact!, created: false }
    }

    await this.limits.assertCanCreate('contacts')

    const [inserted] = await db
      .insert(contacts)
      .values(
        this.scope.values({
          email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          attributes: ContactService.cleanAttributes(input.attributes ?? {}),
          status: await this.initialStatus(email),
          source: input.source ?? null,
          consentIp: input.consentIp ?? null
        })
      )
      .onConflictDoNothing({ target: [contacts.organizationId, contacts.email] })
      .returning()

    if (!inserted) {
      // Lost a race with a concurrent insert: the row exists now.
      const [row] = await db.select().from(contacts).where(byEmail)

      if (!row) throw new ConflictError(`Could not create contact ${email}`)

      return { contact: row, created: false }
    }

    await this.audit.log(
      actor,
      {
        action: 'contact.created',
        entityType: 'contact',
        entityId: inserted.id,
        summary: `Created contact ${email}`
      },
      db
    )
    await this.notify('contact.created', ContactService.toPayload(inserted))

    return { contact: inserted, created: true }
  }

  async update(id: string, input: ContactUpdateData, actor: Actor): Promise<ContactRow> {
    const before = await this.findOrFail(id)
    const patch: Partial<typeof contacts.$inferInsert> = {}

    if (input.email !== undefined) {
      const email = ContactService.normalizeEmail(input.email)

      if (email !== before.email) {
        const taken = await this.findByEmail(email)

        if (taken)
          throw new ConflictError(`Another contact already uses ${email}`, 'contact_exists')
        patch.email = email
      }
    }

    if (input.firstName !== undefined) patch.firstName = input.firstName

    if (input.lastName !== undefined) patch.lastName = input.lastName

    if (input.attributes !== undefined) {
      patch.attributes = ContactService.cleanAttributes(
        input.attributesMode === 'replace'
          ? input.attributes
          : { ...before.attributes, ...input.attributes }
      )
    }

    let contact = before

    if (Object.keys(patch).length) {
      const changes = AuditLogger.diff(before, { ...before, ...patch })

      if (Object.keys(changes).length) {
        const [row] = await this.db
          .update(contacts)
          .set(patch)
          .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, id)))
          .returning()

        contact = row!
        await this.audit.log(actor, {
          action: 'contact.updated',
          entityType: 'contact',
          entityId: id,
          summary: `Updated contact ${contact.email}`,
          changes
        })
        await this.notify('contact.updated', ContactService.toPayload(contact))
      }
    }

    if (input.status && input.status !== contact.status)
      contact = await this.setStatus(id, input.status, actor)

    return contact
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const contact = await this.findOrFail(id)
    await this.db
      .delete(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, id)))
    await this.audit.log(actor, {
      action: 'contact.deleted',
      entityType: 'contact',
      entityId: id,
      summary: `Deleted contact ${contact.email}`
    })
    await this.notify('contact.deleted', { id: contact.id, email: contact.email })
  }

  async setStatus(contactId: string, status: ContactStatus, actor: Actor): Promise<ContactRow> {
    const before = await this.findOrFail(contactId)

    if (before.status === status) return before

    const contact = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(contacts)
        .set({ status })
        .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId)))
        .returning()

      if (status === 'blocklisted')
        await this.suppressUnlessHard(before.email, 'manual', `admin:${actor.label}`, tx)

      // Reactivation lifts the suppressions an admin can vouch for; bounces and complaints stay,
      // including one recorded while this runs (the reason is checked by the DELETE itself).
      if (status === 'active')
        await this.suppressions.remove(before.email, tx, { reasons: ['unsubscribe', 'manual'] })

      await this.audit.log(
        actor,
        {
          action: 'contact.status_changed',
          entityType: 'contact',
          entityId: contactId,
          summary: `Changed status of ${before.email} from ${before.status} to ${status}`,
          changes: { status: { from: before.status, to: status } }
        },
        tx
      )

      return row!
    })

    await this.notify('contact.updated', ContactService.toPayload(contact))

    return contact
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------
  /** Adds the contact to a list. Double opt-in lists start the opt-in workflow unless skipOptIn. */
  async subscribe(
    contactId: string,
    listId: string,
    actor: Actor,
    options: SubscribeOptions = {}
  ): Promise<SubscribeResult> {
    const contact = await this.findOrFail(contactId)
    const list = await this.findListOrFail(listId)

    if (contact.status !== 'active' && !options.resubscribe) {
      throw new InvalidStateError(`${contact.email} is ${contact.status} and can't be subscribed`)
    }

    const [existing] = await this.db
      .select()
      .from(listSubscriptions)
      .where(and(eq(listSubscriptions.contactId, contactId), eq(listSubscriptions.listId, listId)))

    if (existing?.status === 'confirmed') return 'already_subscribed'

    if (existing?.status === 'unsubscribed' && !options.resubscribe) {
      throw new InvalidStateError(
        `${contact.email} unsubscribed from "${list.name}". Only an admin can subscribe them again.`
      )
    }

    const needsOptIn = list.optIn === 'double' && !options.skipOptIn
    const status = needsOptIn ? 'unconfirmed' : 'confirmed'
    const now = new Date()
    await this.db
      .insert(listSubscriptions)
      .values({
        listId,
        contactId,
        status,
        confirmedAt: needsOptIn ? null : now,
        unsubscribedAt: null,
        createdAt: now
      })
      .onConflictDoUpdate({
        target: [listSubscriptions.listId, listSubscriptions.contactId],
        set: { status, confirmedAt: needsOptIn ? null : now, unsubscribedAt: null, createdAt: now }
      })

    await this.audit.log(actor, {
      action: 'contact.subscribed',
      entityType: 'contact',
      entityId: contactId,
      summary: needsOptIn
        ? `Sent opt-in confirmation to ${contact.email} for "${list.name}"`
        : `Subscribed ${contact.email} to "${list.name}"`,
      changes: { listId, status }
    })

    if (needsOptIn) {
      await this.jobs.doubleOptIn(this.scope.organizationId, contactId, listId)

      return 'unconfirmed'
    }

    await this.notify('contact.subscribed', {
      id: contact.id,
      email: contact.email,
      listId,
      listName: list.name
    })

    return 'confirmed'
  }

  /**
   * Marks a pending double opt-in subscription as confirmed. Returns false when
   * nothing was pending (or the list belongs to another organization).
   */
  async confirmSubscription(contactId: string, listId: string, actor: Actor): Promise<boolean> {
    const now = new Date()

    const [row] = await this.db
      .update(listSubscriptions)
      .set({ status: 'confirmed', confirmedAt: now })
      .where(
        and(
          eq(listSubscriptions.contactId, contactId),
          eq(listSubscriptions.listId, listId),
          eq(listSubscriptions.status, 'unconfirmed'),
          inArray(listSubscriptions.listId, this.ownedListIds())
        )
      )
      .returning()

    if (!row) return false

    // The confirmation click is the proof of consent.
    const consent: Partial<typeof contacts.$inferInsert> = { consentAt: now }

    if (actor.ip) consent.consentIp = actor.ip

    const [contact] = await this.db
      .update(contacts)
      .set(consent)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId)))
      .returning()

    const [list] = await this.db
      .select({ name: lists.name })
      .from(lists)
      .where(and(this.scope.eq(lists.organizationId), eq(lists.id, listId)))

    await this.audit.log(actor, {
      action: 'contact.subscription_confirmed',
      entityType: 'contact',
      entityId: contactId,
      summary: `${contact?.email ?? contactId} confirmed the subscription to "${list?.name ?? listId}"`,
      changes: { listId }
    })
    await this.notify('contact.subscribed', {
      id: contactId,
      email: contact?.email,
      listId,
      listName: list?.name ?? null
    })

    return true
  }

  /** Unsubscribes from one list, or globally when listId is null (status → unsubscribed + suppression). */
  async unsubscribe(
    contactId: string,
    listId: string | null,
    actor: Actor,
    source: string
  ): Promise<void> {
    const contact = await this.findOrFail(contactId)
    const list = listId ? await this.findListOrFail(listId) : null

    await this.db.transaction(async (tx) => {
      await new SubscriptionWriter(this.scope, tx).removeMany([contactId], listId)

      if (!listId) {
        if (contact.status === 'active')
          await tx
            .update(contacts)
            .set({ status: 'unsubscribed' })
            .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId)))
        await this.suppressUnlessHard(contact.email, 'unsubscribe', source, tx)
      }

      await tx.insert(emailEvents).values(
        this.scope.values({
          contactId,
          type: 'unsubscribe' as const,
          data: { scope: listId ? 'list' : 'global', listId, listName: list?.name ?? null, source }
        })
      )
      await this.audit.log(
        actor,
        {
          action: 'contact.unsubscribed',
          entityType: 'contact',
          entityId: contactId,
          summary: list
            ? `Unsubscribed ${contact.email} from "${list.name}"`
            : `Unsubscribed ${contact.email} from all emails`,
          changes: { listId, source }
        },
        tx
      )
    })

    await this.notify('contact.unsubscribed', {
      id: contactId,
      email: contact.email,
      listId,
      listName: list?.name ?? null,
      source
    })
  }

  // ---------------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------------
  async bulk(input: ContactBulkInput, actor: Actor): Promise<BulkActionResult> {
    // Ids come from the client: other organizations' contacts are dropped silently.
    const ids = [...new Set(input.ids)]

    const targets = await this.db
      .select()
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), inArray(contacts.id, ids)))

    if (!targets.length) return { affected: 0 }
    const targetIds = targets.map((c) => c.id)

    switch (input.action) {
      case 'delete': {
        await this.db
          .delete(contacts)
          .where(and(this.scope.eq(contacts.organizationId), inArray(contacts.id, targetIds)))
        await this.audit.log(actor, {
          action: 'contact.bulk_deleted',
          entityType: 'contact',
          summary: `Deleted ${contactCount(targets.length)}`,
          changes: { emails: targets.map((c) => c.email).slice(0, 100) }
        })

        for (const c of targets) await this.notify('contact.deleted', { id: c.id, email: c.email })

        return { affected: targets.length }
      }

      case 'unsubscribe': {
        const active = targets.filter((c) => c.status !== 'unsubscribed')

        for (const c of active) await this.unsubscribe(c.id, null, actor, `admin:${actor.label}`)

        return { affected: active.length }
      }

      case 'add_to_list': {
        const list = await this.findListOrFail(input.listId)
        const status = list.optIn === 'double' && !input.skipOptIn ? 'unconfirmed' : 'confirmed'

        const written = await new SubscriptionWriter(this.scope, this.db).addMany(
          targetIds,
          list.id,
          status
        )

        await this.audit.log(actor, {
          action: 'contact.bulk_subscribed',
          entityType: 'list',
          entityId: list.id,
          summary:
            status === 'unconfirmed'
              ? `Sent opt-in confirmation to ${contactCount(written.length)} for "${list.name}"`
              : `Added ${contactCount(written.length)} to "${list.name}"`,
          changes: { requested: targets.length, written: written.length, status }
        })
        const writtenIds = written.map((w) => w.contactId)

        if (status === 'unconfirmed') {
          await SubscriptionWriter.launchOptIns(
            this.jobs,
            this.scope.organizationId,
            writtenIds,
            list.id
          )
        } else {
          const byId = new Map(targets.map((c) => [c.id, c]))

          for (const id of writtenIds)
            await this.notify('contact.subscribed', {
              id,
              email: byId.get(id)?.email,
              listId: list.id,
              listName: list.name
            })
        }

        return { affected: written.length }
      }

      case 'remove_from_list': {
        const list = await this.findListOrFail(input.listId)

        const removed = await this.db.transaction(async (tx) => {
          const changed = await new SubscriptionWriter(this.scope, tx).removeMany(
            targetIds,
            list.id
          )

          if (changed.length) {
            await tx.insert(emailEvents).values(
              this.scope.valuesMany(
                changed.map((contactId) => ({
                  contactId,
                  type: 'unsubscribe' as const,
                  data: {
                    scope: 'list',
                    listId: list.id,
                    listName: list.name,
                    source: `admin:${actor.label}`
                  }
                }))
              )
            )
          }

          await this.audit.log(
            actor,
            {
              action: 'contact.bulk_unsubscribed',
              entityType: 'list',
              entityId: list.id,
              summary: `Removed ${contactCount(changed.length)} from "${list.name}"`,
              changes: { requested: targets.length, removed: changed.length }
            },
            tx
          )

          return changed
        })

        const byId = new Map(targets.map((c) => [c.id, c]))

        for (const id of removed) {
          await this.notify('contact.unsubscribed', {
            id,
            email: byId.get(id)?.email,
            listId: list.id,
            listName: list.name,
            source: `admin:${actor.label}`
          })
        }

        return { affected: removed.length }
      }

      case 'set_status': {
        const changing = targets.filter((c) => c.status !== input.status)

        for (const c of changing) await this.setStatus(c.id, input.status, actor)

        return { affected: changing.length }
      }
    }
  }

  toTemplateVariables(contact: ContactRow): ContactVariables {
    return {
      id: contact.id,
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      attributes: contact.attributes
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /** A list of the organization (another organization's id → NotFoundError). */
  private async findListOrFail(listId: string): Promise<typeof lists.$inferSelect> {
    const [list] = await this.db
      .select()
      .from(lists)
      .where(and(this.scope.eq(lists.organizationId), eq(lists.id, listId)))

    if (!list) throw new NotFoundError('List', listId)

    return list
  }

  /** Sub-select of the organization's list ids (guards writes on `list_subscriptions`). */
  private ownedListIds() {
    return this.db.select({ id: lists.id }).from(lists).where(this.scope.eq(lists.organizationId))
  }

  /** A new contact inherits the state implied by an existing suppression (e.g. re-imported bounce). */
  private async initialStatus(email: string): Promise<ContactStatus> {
    const suppression = await this.suppressions.find(email)

    return (suppression && SUPPRESSION_STATUS[suppression.reason]) || 'active'
  }

  /** Adds a suppression without weakening an existing bounce/complaint/manual block. */
  private async suppressUnlessHard(
    email: string,
    reason: SuppressionReason,
    source: string,
    tx: Executor
  ): Promise<void> {
    const existing = await this.suppressions.find(email, tx)

    if (existing && HARD_SUPPRESSIONS.has(existing.reason)) return
    await this.suppressions.add(email, reason, source, tx)
  }

  /** Drops null/undefined values: in a merge, `null` means "remove this attribute". */
  static cleanAttributes(attributes: JsonObject): JsonObject {
    return Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== null && value !== undefined)
    )
  }
}
