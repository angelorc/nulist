import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts as contactsTable, listSubscriptions, lists, messages } from '../../db/schema'
import type { ConfirmationPreview, ConfirmationResult } from '../../../shared/schemas/public'
import type {
  ContactStatus,
  GeneralSettings,
  MessageStatus,
  SubscriptionStatus
} from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import type { ContactRow, ContactService } from '../contacts/ContactService'
import type { Actor } from '../core/actor'
import { SYSTEM_ACTOR } from '../core/actor'
import { DomainError, InvalidStateError, ProviderError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import type { MessageSender } from '../email/MessageSender'
import type { LinkBuilder } from '../security/LinkBuilder'
import type { RecipientClaims, TokenService } from '../security/TokenService'
import type { SettingsService } from '../settings/SettingsService'
import type { RenderedEmail, TemplateRenderer } from '../templates/TemplateRenderer'
import { formatMailbox } from '../email/mailbox'
import type { TenantScope } from '../core/TenantScope'
import { maskEmail } from './maskEmail'
import { OptInEmailComposer } from './OptInEmail'
import type { OptInEmailKind } from './OptInEmail'
import type { PublicBrandReader } from './PublicBrand'
import { RecipientTokens } from './RecipientTokens'

/** Payload delivered to the opt-in workflow's hook when the recipient answers. */
export interface OptInHookPayload {
  confirmed: boolean
}

export type OptInSkipReason = 'not_pending' | 'contact_inactive' | 'recently_sent'

interface OptInDispatchBase {
  messageId?: string
  /** Days an unconfirmed subscription stays pending (Settings → Sending). */
  expiryDays: number
}

/** Plain, serializable result returned to the workflow steps. */
export type OptInDispatch =
  | (OptInDispatchBase & { status: 'sent'; messageId: string })
  | (OptInDispatchBase & { status: 'skipped'; reason: OptInSkipReason })
  /** The address is suppressed in this organization (reason: bounce, complaint, …). */
  | (OptInDispatchBase & { status: 'suppressed'; reason: string })
  /** No sender address configured (`no_sender`) or the provider rejected the email. */
  | (OptInDispatchBase & { status: 'failed'; reason: string })

export interface OptInDispatchOptions {
  /** Last attempt of the workflow step: a retryable provider error becomes a permanent failure. */
  finalAttempt?: boolean
  /** Lifetime of the confirmation link (defaults to the configured expiry). */
  expiresInDays?: number
}

interface PendingOptIn {
  contact: ContactRow
  list: typeof lists.$inferSelect
  status: SubscriptionStatus | null
}

const MESSAGE_PURPOSE: Record<OptInEmailKind, string> = {
  confirmation: 'optin_confirmation',
  reminder: 'optin_reminder'
}

/** A second confirmation for the same list is not sent within this window (form re-submits, abuse). */
const RESEND_COOLDOWN_MINUTES = 5

/** Messages still queued/sending after a crash are reused by the retried step instead of duplicated. */
const IN_FLIGHT: MessageStatus[] = ['queued', 'sending']
const DELIVERED: MessageStatus[] = ['sent', 'delivered', 'delayed']

/**
 * Double opt-in of one organization: confirmation and reminder emails, the
 * confirmation click and expiry of subscriptions that were never confirmed.
 * Contacts, lists and messages of other organizations are "not found". The
 * waiting itself is orchestrated by the `doubleOptInWorkflow`
 * (server/workflows/double-opt-in.ts).
 */
export class OptInService {
  private readonly composer: OptInEmailComposer
  private readonly recipients: RecipientTokens

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly contacts: ContactService,
    protected readonly renderer: TemplateRenderer,
    protected readonly sender: MessageSender,
    protected readonly links: LinkBuilder,
    protected readonly settings: SettingsService,
    protected readonly jobs: JobLauncher,
    protected readonly tokens: TokenService,
    protected readonly audit: AuditLogger,
    protected readonly brand: PublicBrandReader
  ) {
    this.composer = OptInEmailComposer.for(renderer)
    this.recipients = new RecipientTokens(scope, tokens)
  }

  /** Workflow hook token shared by the workflow (createHook) and confirm() (resumeHook). */
  static hookToken(contactId: string, listId: string): string {
    return `optin:${contactId}:${listId}`
  }

  async expiryDays(): Promise<number> {
    return (await this.settings.get('sending')).optInExpiryDays
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------
  /** Sends the confirmation email for a pending (unconfirmed) subscription. */
  async sendConfirmation(
    contactId: string,
    listId: string,
    options: OptInDispatchOptions = {}
  ): Promise<OptInDispatch> {
    return this.dispatch('confirmation', contactId, listId, options)
  }

  /** Sends one reminder with a fresh link valid for the remaining days. */
  async sendReminder(
    contactId: string,
    listId: string,
    options: OptInDispatchOptions = {}
  ): Promise<OptInDispatch> {
    const result = await this.dispatch('reminder', contactId, listId, options)

    if (result.status === 'sent') {
      await this.audit.log(this.systemActor(), {
        action: 'contact.optin_reminder_sent',
        entityType: 'contact',
        entityId: contactId,
        summary: 'Sent an opt-in reminder',
        changes: { listId, messageId: result.messageId }
      })
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Recipient actions
  // ---------------------------------------------------------------------------
  /** Read-only look at a confirmation link (GET must never confirm: link scanners prefetch). */
  async inspect(token: string): Promise<ConfirmationPreview> {
    const claims = await this.verify(token)
    const [pending, brand] = await Promise.all([this.load(claims.c, claims.l), this.brand.read()])

    if (!pending) throw RecipientTokens.invalid()
    const { contact, list, status } = pending

    return {
      state:
        status === 'confirmed'
          ? 'confirmed'
          : status === 'unconfirmed' && contact.status === 'active'
            ? 'pending'
            : 'expired',
      email: maskEmail(contact.email),
      list: { id: list.id, name: list.name, description: list.description },
      canSignUpAgain: list.isPublic && contact.status === 'active',
      brand
    }
  }

  /** The confirmation click: confirms the subscription and wakes the waiting workflow. */
  async confirm(token: string, actor: Actor): Promise<ConfirmationResult> {
    const claims = await this.verify(token)
    const pending = await this.load(claims.c, claims.l)

    if (!pending) throw RecipientTokens.invalid()
    const { contact, list } = pending

    if (contact.status !== 'active') {
      throw new InvalidStateError(OptInService.inactiveMessage(contact.status))
    }

    const confirmed = await this.contacts.confirmSubscription(contact.id, list.id, {
      ...actor,
      organizationId: this.scope.organizationId,
      label: contact.email
    })

    if (!confirmed) {
      const current = await this.subscriptionStatus(contact.id, list.id)

      if (current === 'confirmed')
        return { listId: list.id, listName: list.name, alreadyConfirmed: true }
      throw new DomainError(
        'This confirmation link has expired. Sign up again to get a new one.',
        410,
        'optin_expired',
        { listId: list.isPublic ? list.id : null }
      )
    }

    // The database is the source of truth: a missing hook (finished run) is fine.
    try {
      await this.jobs.resumeHook(OptInService.hookToken(contact.id, list.id), {
        confirmed: true
      } satisfies OptInHookPayload)
    } catch (error) {
      console.error('[optin] could not resume the opt-in workflow', error)
    }

    return { listId: list.id, listName: list.name, alreadyConfirmed: false }
  }

  /** Removes a subscription that was never confirmed. Confirmed/unsubscribed rows are left untouched. */
  async expire(contactId: string, listId: string): Promise<{ expired: boolean }> {
    // list_subscriptions has no organization column: the pair is checked through its scoped parents.
    const pending = await this.load(contactId, listId)

    if (pending?.status !== 'unconfirmed') return { expired: false }

    const removed = await this.db
      .delete(listSubscriptions)
      .where(
        and(
          eq(listSubscriptions.contactId, contactId),
          eq(listSubscriptions.listId, listId),
          eq(listSubscriptions.status, 'unconfirmed')
        )
      )
      .returning({ contactId: listSubscriptions.contactId })

    if (!removed.length) return { expired: false }

    await this.audit.log(this.systemActor(), {
      action: 'contact.optin_expired',
      entityType: 'contact',
      entityId: contactId,
      summary: `${pending.contact.email} did not confirm "${pending.list.name}" in time; the pending subscription was removed`,
      changes: { listId }
    })

    return { expired: true }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async dispatch(
    kind: OptInEmailKind,
    contactId: string,
    listId: string,
    options: OptInDispatchOptions
  ): Promise<OptInDispatch> {
    const expiryDays = await this.expiryDays()
    const pending = await this.load(contactId, listId)

    if (!pending || pending.status !== 'unconfirmed')
      return { status: 'skipped', reason: 'not_pending', expiryDays }

    if (pending.contact.status !== 'active')
      return { status: 'skipped', reason: 'contact_inactive', expiryDays }

    const purpose = MESSAGE_PURPOSE[kind]
    const recent = await this.recentMessage(contactId, listId, purpose)

    // Delivered already (a form re-submit, or a retried step): never email twice. A run sends one
    // reminder, so a recent one is this step's own earlier delivery and the retry completes it.
    if (recent && DELIVERED.includes(recent.status)) {
      return kind === 'reminder'
        ? { status: 'sent', messageId: recent.id, expiryDays }
        : { status: 'skipped', reason: 'recently_sent', messageId: recent.id, expiryDays }
    }

    const general = await this.settings.get('general')

    if (!general.defaultFromEmail) return { status: 'failed', reason: 'no_sender', expiryDays }

    const linkDays = Math.max(1, Math.round(options.expiresInDays ?? expiryDays))

    const content = await this.composer.render({
      kind,
      contact: this.contacts.toTemplateVariables(pending.contact),
      list: { name: pending.list.name, description: pending.list.description },
      company: { name: general.companyName || general.appName, address: general.companyAddress },
      // The organization claim (`o`) is added by the scoped LinkBuilder.
      confirmUrl: await this.links.confirmUrl({ c: contactId, l: listId }, linkDays),
      expiresInDays: linkDays
    })

    const messageId =
      recent && IN_FLIGHT.includes(recent.status)
        ? recent.id
        : await this.insertMessage(pending.contact, listId, purpose, general, content)

    try {
      const outcome = await this.sender.deliver({ messageId, content })

      if (outcome.status === 'sent') return { status: 'sent', messageId, expiryDays }

      if (outcome.status === 'suppressed')
        return { status: 'suppressed', reason: outcome.reason, messageId, expiryDays }

      return { status: 'failed', reason: outcome.error, messageId, expiryDays }
    } catch (error) {
      if (error instanceof ProviderError && error.retryable && options.finalAttempt) {
        await this.sender.markFailed(messageId, error.message)

        return { status: 'failed', reason: error.message, messageId, expiryDays }
      }

      throw error
    }
  }

  private async insertMessage(
    contact: ContactRow,
    listId: string,
    purpose: string,
    general: GeneralSettings,
    content: RenderedEmail
  ): Promise<string> {
    const [row] = await this.db
      .insert(messages)
      .values(
        this.scope.values({
          kind: 'system' as const,
          contactId: contact.id,
          toEmail: contact.email,
          fromEmail: formatMailbox(general.defaultFromName, general.defaultFromEmail),
          replyTo: general.defaultReplyTo || null,
          subject: content.subject,
          html: content.html,
          text: content.text,
          tags: { purpose, list_id: listId }
        })
      )
      .returning({ id: messages.id })

    if (!row) throw new DomainError('Could not queue the confirmation email', 500, 'internal_error')

    return row.id
  }

  /** Latest opt-in email of this kind for the pair inside the cooldown window. */
  private async recentMessage(contactId: string, listId: string, purpose: string) {
    const since = new Date(Date.now() - RESEND_COOLDOWN_MINUTES * 60_000)

    const [row] = await this.db
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.contactId, contactId),
          eq(messages.kind, 'system'),
          sql`${messages.tags}->>'purpose' = ${purpose}`,
          sql`${messages.tags}->>'list_id' = ${listId}`,
          gt(messages.createdAt, since),
          inArray(messages.status, [...IN_FLIGHT, ...DELIVERED])
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1)

    return row ?? null
  }

  /** A valid opt-in token of this organization (`o` mismatch → invalid) that names a list. */
  private async verify(token: string): Promise<RecipientClaims & { l: string }> {
    const claims = await this.recipients.verify('optin', token)

    if (!claims.l) throw RecipientTokens.invalid()

    return { ...claims, l: claims.l }
  }

  /** The contact and the list (both of this organization) and the pair's subscription status. */
  private async load(contactId: string, listId: string): Promise<PendingOptIn | null> {
    const [row] = await this.db
      .select({ contact: contactsTable, list: lists, status: listSubscriptions.status })
      .from(contactsTable)
      .innerJoin(lists, and(eq(lists.id, listId), this.scope.eq(lists.organizationId)))
      .leftJoin(
        listSubscriptions,
        and(
          eq(listSubscriptions.contactId, contactsTable.id),
          eq(listSubscriptions.listId, lists.id)
        )
      )
      .where(and(this.scope.eq(contactsTable.organizationId), eq(contactsTable.id, contactId)))

    return row ?? null
  }

  /** System entries (reminders, expiry) are recorded in this organization. */
  private systemActor(): Actor {
    return { ...SYSTEM_ACTOR, organizationId: this.scope.organizationId }
  }

  private async subscriptionStatus(
    contactId: string,
    listId: string
  ): Promise<SubscriptionStatus | null> {
    const [row] = await this.db
      .select({ status: listSubscriptions.status })
      .from(listSubscriptions)
      .where(and(eq(listSubscriptions.contactId, contactId), eq(listSubscriptions.listId, listId)))

    return row?.status ?? null
  }

  private static inactiveMessage(status: ContactStatus): string {
    return status === 'unsubscribed'
      ? 'This address unsubscribed from all emails. Resubscribe from the preference center first.'
      : "We can't send email to this address, so the subscription can't be confirmed."
  }
}
