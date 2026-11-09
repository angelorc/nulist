import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import pThrottle from 'p-throttle'
import type { Database } from '../../db/client'
import { broadcasts, contacts, messages, topics } from '../../db/schema'
import type { BroadcastBatchResult, BroadcastBatchState } from '../../../shared/types/broadcasts'
import type { BroadcastStatus } from '../../../shared/types/domain'
import { DomainError, ProviderError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { DeliveryOutcome, MessageSender } from '../email/MessageSender'
import type { LimitService } from '../limits/LimitService'
import { TopicService } from '../lists/TopicService'
import type { SettingsService } from '../settings/SettingsService'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import type { BroadcastAudience } from './BroadcastAudience'
import { BroadcastContent } from './BroadcastContent'
import type { RecipientContact } from './BroadcastContent'

type BroadcastRow = typeof broadcasts.$inferSelect

/** A `messages` row claimed by this batch. */
interface ClaimedMessage {
  id: string
  contactId: string | null
  toEmail: string
}

interface Recipient extends RecipientContact {
  status: string
  acceptsTopic: boolean
  /** Still matches the broadcast audience (lists ∪ segments − excluded lists). */
  inAudience: boolean
}

type StopReason = 'paused' | 'cancelled' | 'throttled' | 'error'

/** Messages stuck in `sending` this long (crashed attempt) are claimed again. */
const STALE_SENDING_MS = 5 * 60_000

/** How often a running batch checks whether the broadcast was paused or cancelled. */
const STATUS_POLL_MS = 2_000
const MAX_CONCURRENCY = 8

/** The thrown value as an Error (anything else is wrapped). */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/** Stops a running batch: set once, observed by every worker before its next message. */
class StopSignal {
  reason: StopReason | null = null
  error: Error | null = null

  stop(reason: StopReason, error?: Error) {
    if (this.reason) return
    this.reason = reason
    this.error = error ?? null
  }

  get stopped() {
    return this.reason !== null
  }
}

/**
 * Sends one batch of a broadcast: claims queued messages (`FOR UPDATE SKIP LOCKED`),
 * renders each one for its contact and hands it to the provider through
 * MessageSender, throttled to Settings → Sending → rate per second.
 * Pausing or cancelling the broadcast stops the batch within a couple of seconds;
 * provider throttling puts the message back and asks the workflow to back off.
 * Only messages, contacts and topics of the scope's organization are touched;
 * sender, limits, settings and webhooks are the organization's own.
 */
export class BroadcastBatchSender {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    private readonly content: BroadcastContent,
    private readonly sender: MessageSender,
    private readonly limits: LimitService,
    private readonly settings: SettingsService,
    private readonly webhooks: WebhookDispatcher,
    private readonly audience: BroadcastAudience
  ) {}

  async send(broadcast: BroadcastRow, size: number): Promise<BroadcastBatchResult> {
    const result: BroadcastBatchResult = {
      sent: 0,
      failed: 0,
      suppressed: 0,
      remaining: 0,
      state: 'continue'
    }

    const capacity = await this.limits.remainingSendCapacity()

    if (capacity <= 0)
      return { ...result, remaining: await this.remaining(broadcast.id), state: 'limited' }

    if (!broadcast.htmlSnapshot)
      throw new DomainError('The broadcast has no content snapshot', 500, 'missing_snapshot')
    const prepared = await this.content.prepare(broadcast, broadcast.htmlSnapshot)

    const claimed = await this.claim(broadcast.id, Math.max(1, Math.min(size, capacity)))

    if (!claimed.length) {
      const remaining = await this.remaining(broadcast.id)

      // Only in-flight messages of an interrupted attempt are left: wait until they can be reclaimed.
      return { ...result, remaining, state: remaining ? 'throttled' : 'done' }
    }

    const [recipients, sending, company, topic] = await Promise.all([
      this.recipients(claimed, broadcast),
      this.settings.get('sending'),
      this.content.company(),
      broadcast.topicId
        ? this.db
            .select({ name: topics.name })
            .from(topics)
            .where(and(this.scope.eq(topics.organizationId), eq(topics.id, broadcast.topicId)))
            .then((r) => r[0] ?? null)
        : null
    ])

    const rate = Math.max(1, sending.ratePerSecond)
    const throttle = pThrottle({ limit: rate, interval: 1000 })

    const deliver = throttle((request: Parameters<MessageSender['deliver']>[0]) =>
      this.sender.deliver(request)
    )

    const listId = BroadcastContent.listId(broadcast)

    const signal = new StopSignal()
    const attempted = new Set<string>()

    const poll = setInterval(() => void this.watchStatus(broadcast.id, signal), STATUS_POLL_MS)

    const processOne = async (message: ClaimedMessage) => {
      const recipient = message.contactId ? recipients.get(message.contactId) : undefined

      if (!recipient || recipient.status !== 'active') {
        await this.suppress(
          broadcast,
          message,
          recipient ? `Contact is ${recipient.status}` : 'Contact was deleted'
        )
        result.suppressed++

        return
      }

      if (!recipient.acceptsTopic) {
        await this.suppress(broadcast, message, `Opted out of topic "${topic?.name ?? 'unknown'}"`)
        result.suppressed++

        return
      }

      if (!recipient.inAudience) {
        await this.suppress(
          broadcast,
          message,
          'No longer in the audience (unsubscribed from its lists or added to an excluded list)'
        )
        result.suppressed++

        return
      }

      let rendered
      let unsubscribeUrl: string

      try {
        const links = await this.content.recipientLinks(recipient.id, message.id)
        unsubscribeUrl = links.unsubscribe_url
        rendered = await prepared.render(
          this.content.variables(BroadcastContent.contactVariables(recipient), links, company)
        )
      } catch (error) {
        await this.sender.markFailed(message.id, `Rendering failed: ${asError(error).message}`)
        result.failed++

        return
      }

      const outcome: DeliveryOutcome = await deliver({
        messageId: message.id,
        content: rendered,
        unsubscribeUrl,
        headers: { 'List-Id': listId }
      })

      if (outcome.status === 'sent') result.sent++
      else if (outcome.status === 'suppressed') result.suppressed++
      else if (outcome.error !== 'cancelled') result.failed++
    }

    let cursor = 0

    const worker = async () => {
      while (!signal.stopped && cursor < claimed.length) {
        const message = claimed[cursor++]!
        attempted.add(message.id)

        try {
          await processOne(message)
        } catch (error) {
          if (error instanceof ProviderError && error.retryable) signal.stop('throttled', error)
          else signal.stop('error', asError(error))
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENCY, rate, claimed.length) }, worker)
      )
    } finally {
      clearInterval(poll)
      await this.release(
        claimed.filter((m) => !attempted.has(m.id) || signal.reason === 'error').map((m) => m.id)
      )
    }

    if (signal.reason === 'error') throw signal.error ?? new Error('The batch stopped on an error')
    result.remaining = await this.remaining(broadcast.id)
    result.state = this.nextState(signal.reason, result.remaining)

    return result
  }

  private nextState(reason: StopReason | null, remaining: number): BroadcastBatchState {
    if (reason === 'paused' || reason === 'cancelled' || reason === 'throttled') return reason

    return remaining ? 'continue' : 'done'
  }

  /** Stops the batch once the broadcast is paused or cancelled. */
  private async watchStatus(broadcastId: string, signal: StopSignal): Promise<void> {
    try {
      const status = await this.status(broadcastId)

      if (status === 'paused' || status === 'cancelled') signal.stop(status)
    } catch {
      // A failed poll is retried on the next tick.
    }
  }

  async status(broadcastId: string): Promise<BroadcastStatus | null> {
    const [row] = await this.db
      .select({ status: broadcasts.status })
      .from(broadcasts)
      .where(and(this.scope.eq(broadcasts.organizationId), eq(broadcasts.id, broadcastId)))

    return row?.status ?? null
  }

  /** Messages not yet handed to the provider (queued or in flight). */
  async remaining(broadcastId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.broadcastId, broadcastId),
          inArray(messages.status, ['queued', 'sending'])
        )
      )

    return row?.value ?? 0
  }

  /** Atomically moves up to `limit` queued (or stale in-flight) messages to `sending`. */
  private async claim(broadcastId: string, limit: number): Promise<ClaimedMessage[]> {
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS)

    const claimable = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.broadcastId, broadcastId),
          or(
            eq(messages.status, 'queued'),
            and(
              eq(messages.status, 'sending'),
              isNull(messages.providerMessageId),
              lt(messages.updatedAt, staleBefore)
            )
          )
        )
      )
      .orderBy(messages.id)
      .limit(limit)
      .for('update', { skipLocked: true })

    return this.db
      .update(messages)
      .set({ status: 'sending' })
      .where(and(this.scope.eq(messages.organizationId), inArray(messages.id, claimable)))
      .returning({ id: messages.id, contactId: messages.contactId, toEmail: messages.toEmail })
  }

  /** Claimed messages that were not attempted go back to the queue. */
  private async release(ids: string[]): Promise<void> {
    if (!ids.length) return
    await this.db
      .update(messages)
      .set({ status: 'queued' })
      .where(
        and(
          this.scope.eq(messages.organizationId),
          inArray(messages.id, ids),
          eq(messages.status, 'sending'),
          isNull(messages.providerMessageId)
        )
      )
  }

  private async recipients(
    claimed: ClaimedMessage[],
    broadcast: Pick<BroadcastRow, 'audience' | 'topicId'>
  ): Promise<Map<string, Recipient>> {
    const ids = claimed.flatMap((m) => (m.contactId ? [m.contactId] : []))

    if (!ids.length) return new Map()
    const { topicId } = broadcast

    const [topic] = topicId
      ? await this.db
          .select({ id: topics.id, defaultSubscribed: topics.defaultSubscribed })
          .from(topics)
          .where(and(this.scope.eq(topics.organizationId), eq(topics.id, topicId)))
      : []

    const accepts = topic ? TopicService.acceptsTopicCondition(topic) : sql`true`
    const inAudience = await this.audience.condition(broadcast.audience)

    const rows = await this.db
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        attributes: contacts.attributes,
        status: contacts.status,
        acceptsTopic: sql<boolean>`(${accepts})`,
        inAudience: sql<boolean>`(${inAudience})`
      })
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), inArray(contacts.id, ids)))

    return new Map(rows.map((row) => [row.id, row]))
  }

  private async suppress(
    broadcast: BroadcastRow,
    message: ClaimedMessage,
    reason: string
  ): Promise<void> {
    await this.db
      .update(messages)
      .set({ status: 'suppressed', error: `Suppressed: ${reason}` })
      .where(and(this.scope.eq(messages.organizationId), eq(messages.id, message.id)))
    await this.webhooks.dispatch('email.suppressed', {
      id: message.id,
      to: message.toEmail,
      reason,
      broadcastId: broadcast.id
    })
  }
}
