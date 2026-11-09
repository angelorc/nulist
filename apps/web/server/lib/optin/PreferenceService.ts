import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  broadcasts,
  contacts as contactsTable,
  emailEvents,
  listSubscriptions,
  lists,
  messages
} from '../../db/schema'
import type {
  PreferenceList,
  PreferencesUpdate,
  PublicPreferences
} from '../../../shared/schemas/public'
import type { OptInMode, SubscriptionStatus } from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import type { ContactRow, ContactService } from '../contacts/ContactService'
import type { SuppressionService } from '../contacts/SuppressionService'
import type { Actor } from '../core/actor'
import { publicActor } from '../core/actor'
import { InvalidStateError, NotFoundError, ValidationError } from '../core/errors'
import type { TopicPreference, TopicService } from '../lists/TopicService'
import type { RecipientClaims, TokenService } from '../security/TokenService'
import type { TenantScope } from '../core/TenantScope'
import { maskEmail } from './maskEmail'
import type { PublicBrandReader } from './PublicBrand'
import { RecipientTokens } from './RecipientTokens'

/** The recipient behind a preference / unsubscribe link and the lists that link is about. */
export interface RecipientContext {
  contact: ContactRow
  /** Lists the link is scoped to: the `l` claim, or the audience lists of the broadcast (`m` claim). */
  scopeListIds: string[]
  messageId: string | null
}

export interface OneClickResult {
  /** False when nothing changed (already unsubscribed, deleted contact): the request still succeeds. */
  changed: boolean
  scope: 'lists' | 'global'
  listIds: string[]
}

interface ListRow {
  id: string
  name: string
  description: string | null
  optIn: OptInMode
  isPublic: boolean
  status: SubscriptionStatus | null
}

const SUBSCRIBED: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'confirmed',
  'unconfirmed'
])

const DEFAULT_ACTOR = publicActor('Preference center')

/**
 * Recipient self-service behind signed links, inside one organization: RFC 8058
 * one-click unsubscribe and the preference center (lists, topics, unsubscribe
 * from all, resubscribe). Only this organization's lists and topics are shown
 * or can be joined. List membership changes go through ContactService so audits
 * and webhooks fire.
 */
export class PreferenceService {
  private readonly recipients: RecipientTokens

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly tokens: TokenService,
    protected readonly contacts: ContactService,
    protected readonly topics: TopicService,
    protected readonly audit: AuditLogger,
    protected readonly suppressions: SuppressionService,
    protected readonly brand: PublicBrandReader
  ) {
    this.recipients = new RecipientTokens(scope, tokens)
  }

  /** Verifies a preference/unsubscribe token of this organization and loads the recipient. */
  async resolve(token: string): Promise<RecipientContext> {
    const claims = await this.recipients.verify('unsubscribe', token)

    const [contact] = await this.db
      .select()
      .from(contactsTable)
      .where(and(this.scope.eq(contactsTable.organizationId), eq(contactsTable.id, claims.c)))

    if (!contact) throw new NotFoundError('Contact')

    return { contact, scopeListIds: await this.scopeFor(claims), messageId: claims.m ?? null }
  }

  // ---------------------------------------------------------------------------
  // RFC 8058 one-click
  // ---------------------------------------------------------------------------
  /**
   * Unsubscribes from the lists the email was sent to; when the recipient was not
   * reached through a list (segments, transactional), unsubscribes globally.
   * Idempotent: repeating the request is a successful no-op.
   */
  async oneClickUnsubscribe(
    token: string,
    actor: Actor = publicActor('One-click unsubscribe')
  ): Promise<OneClickResult> {
    let ctx: RecipientContext

    try {
      ctx = await this.resolve(token)
    } catch (error) {
      // A deleted contact receives nothing anymore: report success.
      if (error instanceof NotFoundError) return { changed: false, scope: 'global', listIds: [] }
      throw error
    }

    const { contact } = ctx
    const self = this.selfActor(actor, contact)

    if (contact.status !== 'active') return { changed: false, scope: 'global', listIds: [] }

    if (ctx.scopeListIds.length) {
      const memberships = (await this.listRows(contact.id)).filter(
        (row) => ctx.scopeListIds.includes(row.id) && row.status !== null
      )

      const active = memberships.filter((row) => row.status && SUBSCRIBED.has(row.status))

      if (active.length) {
        // One at a time: each unsubscribe records its own event, audit entry and webhook.
        for (const row of active)
          await this.contacts.unsubscribe(contact.id, row.id, self, 'one_click')
        await this.attributeToMessage(contact.id, ctx.messageId, active.length)

        return { changed: true, scope: 'lists', listIds: active.map((row) => row.id) }
      }

      // Already left every list this email was sent to.
      if (memberships.length) return { changed: false, scope: 'lists', listIds: [] }
    }

    await this.contacts.unsubscribe(contact.id, null, self, 'one_click')
    await this.attributeToMessage(contact.id, ctx.messageId, 1)

    return { changed: true, scope: 'global', listIds: [] }
  }

  // ---------------------------------------------------------------------------
  // Preference center
  // ---------------------------------------------------------------------------
  async getPreferences(token: string): Promise<PublicPreferences> {
    return this.snapshot(await this.resolve(token))
  }

  /** Applies list and topic switches. Joining a double opt-in list starts the opt-in flow. */
  async updatePreferences(
    token: string,
    input: PreferencesUpdate,
    actor: Actor = DEFAULT_ACTOR
  ): Promise<PublicPreferences> {
    const ctx = await this.resolve(token)
    const { contact } = ctx

    if (contact.status !== 'active') {
      throw new InvalidStateError(
        contact.status === 'unsubscribed'
          ? 'You are unsubscribed from all emails. Resubscribe first to choose what you receive.'
          : "We can't send email to this address, so preferences can't be changed."
      )
    }

    const self = this.selfActor(actor, contact)

    const rows = new Map((await this.listRows(contact.id)).map((row) => [row.id, row]))

    for (const [listId, want] of Object.entries(input.lists)) {
      const row = rows.get(listId)

      if (!row) throw new NotFoundError('List', listId)
      const current = row.status !== null && SUBSCRIBED.has(row.status)

      if (want === current) continue

      if (want) {
        if (!row.isPublic)
          throw new ValidationError(`"${row.name}" can't be joined from the preference center`)
        // The recipient vouches for themselves: rejoining a list they left is allowed.
        await this.contacts.subscribe(contact.id, listId, self, { resubscribe: true })
      } else {
        await this.contacts.unsubscribe(contact.id, listId, self, 'preferences')
      }
    }

    const topicChanges = await this.applyTopics(contact.id, input.topics)

    if (Object.keys(topicChanges).length) {
      await this.audit.log(self, {
        action: 'contact.topics_updated',
        entityType: 'contact',
        entityId: contact.id,
        summary: `${contact.email} updated topic preferences`,
        changes: topicChanges
      })
    }

    return this.snapshot({ ...ctx, contact: await this.contacts.findOrFail(contact.id) })
  }

  /** Global unsubscribe from the preference center. Idempotent. */
  async unsubscribeAll(token: string, actor: Actor = DEFAULT_ACTOR): Promise<PublicPreferences> {
    const ctx = await this.resolve(token)

    if (ctx.contact.status === 'active') {
      await this.contacts.unsubscribe(
        ctx.contact.id,
        null,
        this.selfActor(actor, ctx.contact),
        'preferences'
      )
      await this.attributeToMessage(ctx.contact.id, ctx.messageId, 1)
    }

    return this.snapshot({ ...ctx, contact: await this.contacts.findOrFail(ctx.contact.id) })
  }

  /**
   * Undoes a global unsubscribe made by the recipient. Never lifts bounces,
   * complaints or admin blocks.
   */
  async resubscribe(token: string, actor: Actor = DEFAULT_ACTOR): Promise<PublicPreferences> {
    const ctx = await this.resolve(token)
    const { contact } = ctx

    if (contact.status === 'active') return this.snapshot(ctx)

    if (!(await this.canResubscribe(contact))) {
      throw new InvalidStateError(
        "We can't send email to this address. Contact us if you think this is a mistake."
      )
    }

    // setStatus('active') also lifts the 'unsubscribe' suppression (checked above to be the only one).
    const updated = await this.contacts.setStatus(
      contact.id,
      'active',
      this.selfActor(actor, contact)
    )

    return this.snapshot({ ...ctx, contact: updated })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async snapshot(ctx: RecipientContext): Promise<PublicPreferences> {
    const { contact } = ctx

    const [rows, topicPrefs, canResubscribe, brand] = await Promise.all([
      this.listRows(contact.id),
      this.topicPreferences(contact.id),
      this.canResubscribe(contact),
      this.brand.read()
    ])

    const scope = new Set(ctx.scopeListIds)

    const visible: PreferenceList[] = rows
      // Private lists are shown only while the contact is (or is about to be) a member.
      .filter((row) => row.isPublic || (row.status !== null && SUBSCRIBED.has(row.status)))
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        optIn: row.optIn,
        subscribed: row.status !== null && SUBSCRIBED.has(row.status),
        pending: row.status === 'unconfirmed',
        inScope: scope.has(row.id),
        canJoin: row.isPublic
      }))
      .toSorted((a, b) => Number(b.inScope) - Number(a.inScope))

    return {
      email: maskEmail(contact.email),
      status: contact.status,
      canResubscribe,
      lists: visible,
      topics: topicPrefs.map(({ topic, subscribed }) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description,
        subscribed
      })),
      brand
    }
  }

  /** This organization's public lists plus every one of its lists the contact has a membership row for. */
  private async listRows(contactId: string): Promise<ListRow[]> {
    return this.db
      .select({
        id: lists.id,
        name: lists.name,
        description: lists.description,
        optIn: lists.optIn,
        isPublic: lists.isPublic,
        status: listSubscriptions.status
      })
      .from(lists)
      .leftJoin(
        listSubscriptions,
        and(eq(listSubscriptions.listId, lists.id), eq(listSubscriptions.contactId, contactId))
      )
      .where(
        and(
          this.scope.eq(lists.organizationId),
          or(eq(lists.isPublic, true), isNotNull(listSubscriptions.contactId))
        )
      )
      .orderBy(asc(lists.name))
  }

  /** Topic preferences of the contact, limited to this organization's topics. */
  private async topicPreferences(contactId: string): Promise<TopicPreference[]> {
    const preferences = await this.topics.preferencesFor(contactId)

    return preferences.filter(({ topic }) => this.scope.owns(topic.organizationId))
  }

  private async applyTopics(
    contactId: string,
    wanted: Record<string, boolean>
  ): Promise<Record<string, { from: boolean; to: boolean }>> {
    const ids = Object.keys(wanted)

    if (!ids.length) return {}

    const current = new Map((await this.topicPreferences(contactId)).map((p) => [p.topic.id, p]))

    const changes: Record<string, { from: boolean; to: boolean }> = {}

    for (const [topicId, subscribed] of Object.entries(wanted)) {
      const pref = current.get(topicId)

      if (!pref) throw new NotFoundError('Topic', topicId)

      if (pref.subscribed === subscribed) continue
      await this.topics.setPreference(contactId, topicId, subscribed)
      changes[pref.topic.name] = { from: pref.subscribed, to: subscribed }
    }

    return changes
  }

  /** Lists the link is about: its list claim, or the audience lists of this organization's broadcast. */
  private async scopeFor(claims: RecipientClaims): Promise<string[]> {
    if (claims.l) return [claims.l]

    if (!claims.m) return []

    const [row] = await this.db
      .select({ audience: broadcasts.audience })
      .from(messages)
      .innerJoin(
        broadcasts,
        and(eq(broadcasts.id, messages.broadcastId), this.scope.eq(broadcasts.organizationId))
      )
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.id, claims.m),
          eq(messages.contactId, claims.c)
        )
      )

    return [...new Set(row?.audience.listIds ?? [])]
  }

  /** Only the recipient's own unsubscribe can be undone from a link. */
  private async canResubscribe(contact: ContactRow): Promise<boolean> {
    if (contact.status !== 'unsubscribed') return false
    const suppression = await this.suppressions.find(contact.email)

    return !suppression || suppression.reason === 'unsubscribe'
  }

  /** Audit entries name the recipient acting on their own subscription, in this organization. */
  private selfActor(actor: Actor, contact: ContactRow): Actor {
    return {
      ...actor,
      organizationId: this.scope.organizationId,
      label: `${contact.email} (${actor.label})`
    }
  }

  /**
   * Links the unsubscribe events ContactService just recorded to the email they
   * came from, so broadcast reports can count unsubscribes.
   */
  private async attributeToMessage(
    contactId: string,
    messageId: string | null,
    count: number
  ): Promise<void> {
    if (!messageId || count < 1) return

    try {
      const [message] = await this.db
        .select({ id: messages.id, broadcastId: messages.broadcastId })
        .from(messages)
        .where(
          and(
            this.scope.eq(messages.organizationId),
            eq(messages.id, messageId),
            eq(messages.contactId, contactId)
          )
        )

      if (!message) return

      const latest = this.db
        .select({ id: emailEvents.id })
        .from(emailEvents)
        .where(
          and(
            this.scope.eq(emailEvents.organizationId),
            eq(emailEvents.contactId, contactId),
            eq(emailEvents.type, 'unsubscribe'),
            isNull(emailEvents.messageId)
          )
        )
        .orderBy(desc(emailEvents.id))
        .limit(count)

      await this.db
        .update(emailEvents)
        .set({ messageId: message.id, broadcastId: message.broadcastId })
        .where(and(this.scope.eq(emailEvents.organizationId), inArray(emailEvents.id, latest)))
    } catch (error) {
      console.error('[preferences] could not attribute the unsubscribe to its message', error)
    }
  }
}
