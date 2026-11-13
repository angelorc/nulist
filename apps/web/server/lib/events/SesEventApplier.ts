import { and, eq, ne, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { Executor } from '../../db/client'
import { contacts, emailEvents, listSubscriptions, messages, suppressions } from '../../db/schema'
import type {
  ContactStatus,
  EmailEventType,
  JsonObject,
  MessageStatus,
  SuppressionReason
} from '../../../shared/types/domain'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import { SuppressionService } from '../contacts/SuppressionService'
import { InvalidStateError } from '../core/errors'
import { toJsonObject } from '../core/json'
import type { TenantScope } from '../core/TenantScope'
import type { SettingsService } from '../settings/SettingsService'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import type { SesEvent, SesEventOf } from './SesEvent'
import { StatusPolicy } from './StatusPolicy'

export type SesMessageRow = typeof messages.$inferSelect

type ContactRow = typeof contacts.$inferSelect

/** An outbound webhook raised by an event, sent after the transaction commits. */
export interface PendingWebhook {
  type: WebhookEventType
  data: JsonObject
}

/** Result of applying one event inside its transaction. */
export interface SesOutcome {
  status: 'processed' | 'ignored'
  /** Why the event was ignored (safe to show to members). */
  reason?: string
  /** nulist message the event was correlated with. */
  messageId: string | null
  webhooks: PendingWebhook[]
}

/** Facts written on the message together with a status change. */
interface MessagePatch {
  deliveredAt?: Date
  /** Describes the new status: written only when the status changes (or already matches). */
  error?: string
}

/** Permanent bounce subtypes raised by SES suppression lists rather than the recipient server. */
const SUPPRESSION_LIST_SUBTYPES = new Set(['Suppressed', 'OnAccountSuppressionList'])

/** Link scanners, prefetchers and scripted clients that inflate engagement. */
const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|preview|scanner|barracuda|mimecast|proofpoint|urldefense|safelinks|fireeye|trendmicro|python-requests|go-http-client|curl\/|wget|headless|phantomjs/i

const BOT_VERDICTS = new Map([
  ['likely', true],
  ['true', true],
  ['unlikely', false],
  ['false', false]
])

const MAX_ERROR = 1_000

/**
 * Applies Amazon SES events to ONE organization: message statuses, contacts,
 * the suppression list and `email_events`, then emits the organization's
 * outbound webhooks. The platform router (SesEventProcessor) correlates the
 * event, owns the transaction and passes it in. Every statement is scoped to
 * the organization; statuses only move forward (see StatusPolicy).
 * Lock order everywhere: message → contact → suppression.
 */
export class SesEventApplier {
  constructor(
    protected readonly scope: TenantScope,
    private readonly settings: SettingsService,
    private readonly suppressionList: SuppressionService,
    private readonly webhooks: WebhookDispatcher
  ) {}

  /** Applies `event` inside `tx`. `message` is the correlated message of this organization, if any. */
  async apply(tx: Executor, event: SesEvent, message: SesMessageRow | null): Promise<SesOutcome> {
    if (message && !this.scope.owns(message.organizationId)) {
      throw new InvalidStateError('The SES event was routed to another organization')
    }

    switch (event.eventType) {
      case 'Send':
        return SesEventApplier.ignored(
          'Send events are recorded by nulist when the email is handed to SES',
          message?.id
        )
      case 'Subscription':
        return SesEventApplier.ignored('SES subscription management events are not used')
      case 'Delivery':
        return this.onDelivery(tx, event, message)
      case 'Bounce':
        return this.onBounce(tx, event, message)
      case 'Complaint':
        return this.onComplaint(tx, event, message)
      case 'Reject':
        return this.onReject(tx, event, message)
      case 'Open':
        return this.onOpen(tx, event, message)
      case 'Click':
        return this.onClick(tx, event, message)
      case 'DeliveryDelay':
        return this.onDeliveryDelay(tx, event, message)
      case 'Rendering Failure':
        return this.onRenderingFailure(tx, event, message)
    }
  }

  /** Sends the webhooks of a committed outcome to this organization's endpoints (best effort). */
  async dispatch(webhooks: readonly PendingWebhook[]): Promise<void> {
    for (const webhook of webhooks) {
      try {
        await this.webhooks.dispatch(webhook.type, webhook.data)
      } catch (error) {
        console.error(`[ses-events] failed to dispatch ${webhook.type} webhook`, error)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event rules
  // ---------------------------------------------------------------------------

  private async onDelivery(
    tx: Executor,
    event: SesEventOf<'Delivery'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const { delivery } = event
    const at = SesEventApplier.date(delivery.timestamp, event.mail.timestamp)
    const patch: MessagePatch = {}

    if (!message.deliveredAt) patch.deliveredAt = at
    await this.advance(tx, message, 'delivered', patch)

    // A successful delivery breaks a streak of soft bounces.
    if (message.contactId) {
      await tx
        .update(contacts)
        .set({ softBounceCount: 0 })
        .where(
          and(
            this.scope.eq(contacts.organizationId),
            eq(contacts.id, message.contactId),
            sql`${contacts.softBounceCount} > 0`
          )
        )
    }

    await this.recordEvent(tx, message, 'delivery', at, {
      smtpResponse: delivery.smtpResponse,
      reportingMTA: delivery.reportingMTA,
      processingTimeMillis: delivery.processingTimeMillis,
      recipients: delivery.recipients
    })

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.delivered', {
        ...SesEventApplier.messageRef(message),
        deliveredAt: at.toISOString()
      })
    ])
  }

  private async onBounce(
    tx: Executor,
    event: SesEventOf<'Bounce'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    const { bounce } = event
    const hard = bounce.bounceType === 'Permanent'
    const onSuppressionList = hard && SUPPRESSION_LIST_SUBTYPES.has(bounce.bounceSubType)
    const at = SesEventApplier.date(bounce.timestamp, event.mail.timestamp)
    const first = bounce.bouncedRecipients[0]

    const recipients = SesEventApplier.recipients(
      bounce.bouncedRecipients.map((r) => r.emailAddress),
      message
    )

    const source = `SES ${hard ? 'hard' : 'soft'} bounce (${bounce.bounceType}/${bounce.bounceSubType})`
    const threshold = hard ? 0 : (await this.settings.get('sending')).softBounceThreshold

    let suppressed = false
    let contactsAffected = 0

    for (const email of recipients) {
      const contact = await this.findContact(tx, message, email)

      if (hard) {
        await this.suppress(tx, email, 'hard_bounce', source)
        suppressed = true

        if (contact) await this.setContactStatus(tx, contact, 'bounced')
      } else if (contact) {
        const [row] = await tx
          .update(contacts)
          .set({ softBounceCount: sql`${contacts.softBounceCount} + 1` })
          .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contact.id)))
          .returning({ softBounceCount: contacts.softBounceCount })

        if (row && row.softBounceCount >= threshold) {
          await this.suppress(
            tx,
            email,
            'soft_bounce',
            `${source}, ${row.softBounceCount} in a row`
          )
          await this.setContactStatus(tx, contact, 'bounced')
          suppressed = true
        }
      }

      if (contact) contactsAffected++
    }

    if (!message) {
      return suppressed || contactsAffected
        ? SesEventApplier.recipientRulesOnly([])
        : SesEventApplier.unknownMessage()
    }

    const detail = first?.diagnosticCode ?? first?.status

    await this.advance(tx, message, 'bounced', {
      error: `${hard ? 'Hard' : 'Soft'} bounce: ${bounce.bounceType}/${bounce.bounceSubType}${detail ? ` (${detail})` : ''}`
    })

    const data = {
      type: hard ? 'hard' : 'soft',
      bounceType: bounce.bounceType,
      bounceSubType: bounce.bounceSubType,
      diagnosticCode: first?.diagnosticCode,
      action: first?.action,
      status: first?.status,
      reportingMTA: bounce.reportingMTA,
      feedbackId: bounce.feedbackId,
      suppressed,
      onSuppressionList: onSuppressionList || undefined,
      note: onSuppressionList
        ? 'SES did not attempt delivery: the address is on an SES suppression list'
        : undefined
    }

    await this.recordEvent(tx, message, 'bounce', at, data)

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.bounced', {
        ...SesEventApplier.messageRef(message),
        bouncedAt: at.toISOString(),
        ...data
      })
    ])
  }

  private async onComplaint(
    tx: Executor,
    event: SesEventOf<'Complaint'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    const { complaint } = event

    if (complaint.complaintFeedbackType === 'not-spam') {
      return SesEventApplier.ignored('Feedback type is not-spam', message?.id)
    }

    const at = SesEventApplier.date(complaint.timestamp, event.mail.timestamp)

    const recipients = SesEventApplier.recipients(
      complaint.complainedRecipients.map((r) => r.emailAddress),
      message
    )

    const feedback = complaint.complaintFeedbackType ? ` (${complaint.complaintFeedbackType})` : ''
    const webhooks: PendingWebhook[] = []

    for (const email of recipients) {
      const contact = await this.findContact(tx, message, email)
      await this.suppress(tx, email, 'complaint', `SES complaint${feedback}`)

      if (!contact) continue
      await this.setContactStatus(tx, contact, 'complained')

      // list_subscriptions has no organization column: it is reached through the scoped contact.
      const lists = await tx
        .update(listSubscriptions)
        .set({ status: 'unsubscribed', unsubscribedAt: at })
        .where(
          and(
            eq(listSubscriptions.contactId, contact.id),
            ne(listSubscriptions.status, 'unsubscribed')
          )
        )
        .returning({ listId: listSubscriptions.listId })

      if (lists.length) {
        webhooks.push(
          SesEventApplier.webhook('contact.unsubscribed', {
            id: contact.id,
            email: contact.email,
            listIds: lists.map((l) => l.listId),
            reason: 'complaint',
            source: 'ses'
          })
        )
      }
    }

    if (!message) return SesEventApplier.recipientRulesOnly(webhooks)

    const data = {
      feedbackType: complaint.complaintFeedbackType ?? null,
      complaintSubType: complaint.complaintSubType ?? null,
      userAgent: complaint.userAgent,
      feedbackId: complaint.feedbackId,
      arrivalDate: complaint.arrivalDate
    }

    await this.advance(tx, message, 'complained', {})
    await this.recordEvent(tx, message, 'complaint', at, data)
    webhooks.unshift(
      SesEventApplier.webhook('email.complained', {
        ...SesEventApplier.messageRef(message),
        complainedAt: at.toISOString(),
        ...data
      })
    )

    return SesEventApplier.processed(message, webhooks)
  }

  private async onReject(
    tx: Executor,
    event: SesEventOf<'Reject'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const reason = event.reject.reason ?? 'Rejected by SES'
    const at = SesEventApplier.date(event.mail.timestamp)

    await this.advance(tx, message, 'rejected', { error: `Rejected by SES: ${reason}` })
    await this.recordEvent(tx, message, 'reject', at, { reason })

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.failed', {
        ...SesEventApplier.messageRef(message),
        error: `Rejected by SES: ${reason}`,
        reason: 'rejected'
      })
    ])
  }

  private async onRenderingFailure(
    tx: Executor,
    event: SesEventOf<'Rendering Failure'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const { failure } = event
    const template = failure.templateName ? ` (${failure.templateName})` : ''

    const error = `Rendering failed${template}: ${failure.errorMessage ?? 'unknown error'}`.slice(
      0,
      MAX_ERROR
    )

    const at = SesEventApplier.date(event.mail.timestamp)

    await this.advance(tx, message, 'failed', { error })
    await this.recordEvent(tx, message, 'rendering_failure', at, {
      templateName: failure.templateName,
      errorMessage: failure.errorMessage
    })

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.failed', {
        ...SesEventApplier.messageRef(message),
        error,
        reason: 'rendering_failure'
      })
    ])
  }

  private async onDeliveryDelay(
    tx: Executor,
    event: SesEventOf<'DeliveryDelay'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const { deliveryDelay } = event
    const at = SesEventApplier.date(deliveryDelay.timestamp, event.mail.timestamp)
    const first = deliveryDelay.delayedRecipients[0]

    await this.advance(tx, message, 'delayed', {})

    const data = {
      delayType: deliveryDelay.delayType,
      expirationTime: deliveryDelay.expirationTime,
      status: first?.status,
      diagnosticCode: first?.diagnosticCode,
      reportingMTA: deliveryDelay.reportingMTA
    }

    await this.recordEvent(tx, message, 'delivery_delay', at, data)

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.delivery_delayed', {
        ...SesEventApplier.messageRef(message),
        delayedAt: at.toISOString(),
        ...data
      })
    ])
  }

  private async onOpen(
    tx: Executor,
    event: SesEventOf<'Open'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const { open } = event
    const at = SesEventApplier.date(open.timestamp, event.mail.timestamp)
    const isBotEvent = SesEventApplier.isBot(open.userAgent, open.isBotEvent)
    const first = !message.openedAt && !isBotEvent

    // Scanner and prefetch opens are recorded (flagged) but are not engagement.
    if (!isBotEvent) {
      const set: PgUpdateSetSource<typeof messages> = { openCount: sql`${messages.openCount} + 1` }

      if (first) set.openedAt = at
      await tx.update(messages).set(set).where(this.messageById(message))

      if (message.contactId) {
        await tx
          .update(contacts)
          .set({ lastOpenedAt: SesEventApplier.latest(contacts.lastOpenedAt, at) })
          .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, message.contactId)))
      }
    }

    const data = {
      userAgent: open.userAgent ?? null,
      ipAddress: open.ipAddress ?? null,
      isBotEvent
    }

    await this.recordEvent(tx, message, 'open', at, data)

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.opened', {
        ...SesEventApplier.messageRef(message),
        openedAt: at.toISOString(),
        first,
        ...data
      })
    ])
  }

  private async onClick(
    tx: Executor,
    event: SesEventOf<'Click'>,
    message: SesMessageRow | null
  ): Promise<SesOutcome> {
    if (!message) return SesEventApplier.unknownMessage()
    const { click } = event
    const at = SesEventApplier.date(click.timestamp, event.mail.timestamp)
    const isBotEvent = SesEventApplier.isBot(click.userAgent, click.isBotEvent)
    const first = !message.clickedAt && !isBotEvent

    // Link scanners (Safe Links, Mimecast…) are recorded (flagged) but are not engagement.
    if (!isBotEvent) {
      const set: PgUpdateSetSource<typeof messages> = {
        clickCount: sql`${messages.clickCount} + 1`
      }

      if (first) set.clickedAt = at
      await tx.update(messages).set(set).where(this.messageById(message))

      if (message.contactId) {
        await tx
          .update(contacts)
          .set({ lastClickedAt: SesEventApplier.latest(contacts.lastClickedAt, at) })
          .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, message.contactId)))
      }
    }

    const data = {
      link: click.link,
      linkTags: click.linkTags ?? null,
      userAgent: click.userAgent ?? null,
      ipAddress: click.ipAddress ?? null,
      isBotEvent
    }

    await this.recordEvent(tx, message, 'click', at, data)

    return SesEventApplier.processed(message, [
      SesEventApplier.webhook('email.clicked', {
        ...SesEventApplier.messageRef(message),
        clickedAt: at.toISOString(),
        first,
        ...data
      })
    ])
  }

  // ---------------------------------------------------------------------------
  // Building blocks (all scoped to the organization)
  // ---------------------------------------------------------------------------

  /** The message's contact when it is the recipient, else the organization's contact with that address (locked). */
  private async findContact(
    tx: Executor,
    message: SesMessageRow | null,
    email: string
  ): Promise<ContactRow | null> {
    const normalized = SuppressionService.normalize(email)

    if (message?.contactId && SuppressionService.normalize(message.toEmail) === normalized) {
      const [row] = await tx
        .select()
        .from(contacts)
        .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, message.contactId)))
        .for('update')

      if (row) return row
    }

    // Email is unique per organization only: never look it up unscoped.
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.email, normalized)))
      .for('update')

    return row ?? null
  }

  /** Moves the message forward only; `deliveredAt` is a fact and always written. */
  private async advance(
    tx: Executor,
    message: SesMessageRow,
    to: MessageStatus,
    patch: MessagePatch
  ): Promise<boolean> {
    const advanced = StatusPolicy.canAdvanceMessage(message.status, to)
    const set: PgUpdateSetSource<typeof messages> = {}

    if (patch.deliveredAt) set.deliveredAt = patch.deliveredAt

    if (advanced) set.status = to

    if (patch.error !== undefined && (advanced || message.status === to))
      set.error = patch.error.slice(0, MAX_ERROR)

    if (Object.keys(set).length) await tx.update(messages).set(set).where(this.messageById(message))

    return advanced
  }

  private async setContactStatus(
    tx: Executor,
    contact: ContactRow,
    to: ContactStatus
  ): Promise<void> {
    if (!StatusPolicy.canAdvanceContact(contact.status, to)) return
    await tx
      .update(contacts)
      .set({ status: to })
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contact.id)))
    contact.status = to
  }

  /** Adds or strengthens a suppression; never downgrades (e.g. complaint → soft bounce). */
  private async suppress(
    tx: Executor,
    email: string,
    reason: SuppressionReason,
    source: string
  ): Promise<void> {
    const [existing] = await tx
      .select({ reason: suppressions.reason })
      .from(suppressions)
      .where(
        and(
          this.scope.eq(suppressions.organizationId),
          eq(suppressions.email, SuppressionService.normalize(email))
        )
      )
      .for('update')

    if (!StatusPolicy.shouldReplaceSuppression(existing?.reason ?? null, reason)) return
    await this.suppressionList.add(email, reason, source, tx)
  }

  private async recordEvent<D extends object>(
    tx: Executor,
    message: SesMessageRow,
    type: EmailEventType,
    occurredAt: Date,
    data: D
  ): Promise<void> {
    await tx.insert(emailEvents).values(
      this.scope.values({
        messageId: message.id,
        contactId: message.contactId,
        broadcastId: message.broadcastId,
        type,
        occurredAt,
        data: toJsonObject(data)
      })
    )
  }

  private messageById(message: SesMessageRow) {
    return and(this.scope.eq(messages.organizationId), eq(messages.id, message.id))
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private static messageRef(message: SesMessageRow) {
    return {
      id: message.id,
      to: message.toEmail,
      subject: message.subject,
      contactId: message.contactId,
      broadcastId: message.broadcastId,
      tags: message.tags
    }
  }

  /** Webhook payloads are JSON: undefined fields are dropped, dates become ISO strings. */
  private static webhook<D extends object>(type: WebhookEventType, data: D): PendingWebhook {
    return { type, data: toJsonObject(data) }
  }

  private static processed(message: SesMessageRow, webhooks: PendingWebhook[]): SesOutcome {
    return { status: 'processed', messageId: message.id, webhooks }
  }

  private static ignored(reason: string, messageId?: string | null): SesOutcome {
    return { status: 'ignored', reason, messageId: messageId ?? null, webhooks: [] }
  }

  private static unknownMessage(): SesOutcome {
    return SesEventApplier.ignored('Message not found (not sent by nulist)')
  }

  /** The message is gone but the event's organization is known: recipient rules were applied. */
  private static recipientRulesOnly(webhooks: PendingWebhook[]): SesOutcome {
    return {
      status: 'processed',
      reason: 'Message not found; recipient rules applied',
      messageId: null,
      webhooks
    }
  }

  /**
   * Addresses a bounce or complaint applies to: only the message's own recipient.
   * The listed recipients come from whoever sent through SES, so an address that
   * is not the recipient of this organization's message is never suppressed.
   */
  private static recipients(listed: string[], message: SesMessageRow | null): string[] {
    if (!message) return []
    const recipient = SuppressionService.normalize(message.toEmail)

    if (!recipient) return []

    return listed.length === 0 ||
      listed.some((email) => SuppressionService.normalize(email) === recipient)
      ? [recipient]
      : []
  }

  /** First valid timestamp among the candidates, else now. */
  private static date(...candidates: (string | undefined)[]): Date {
    for (const value of candidates) {
      if (!value) continue
      const date = new Date(value)

      if (!Number.isNaN(date.getTime())) return date
    }

    return new Date()
  }

  /** `greatest(coalesce(column, at), at)` — never moves a "last seen" timestamp backwards. */
  private static latest(
    column: typeof contacts.lastOpenedAt | typeof contacts.lastClickedAt,
    at: Date
  ) {
    const iso = at.toISOString()

    return sql<Date>`greatest(coalesce(${column}, ${iso}::timestamptz), ${iso}::timestamptz)`
  }

  /** SES's own bot verdict (`Likely` / `Unlikely`, or a boolean) when conclusive, else a user-agent heuristic (no agent = bot). */
  static isBot(
    userAgent: string | undefined,
    reported: boolean | string | null | undefined
  ): boolean {
    if (typeof reported === 'boolean') return reported

    const verdict = BOT_VERDICTS.get(reported?.trim().toLowerCase() ?? '')

    if (verdict !== undefined) return verdict

    if (!userAgent?.trim()) return true

    return BOT_USER_AGENT.test(userAgent)
  }
}
