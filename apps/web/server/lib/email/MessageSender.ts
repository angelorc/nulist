import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { emailEvents, messages } from '../../db/schema'
import type { SuppressionReason } from '../../../shared/types/domain'
import { NotFoundError, ProviderError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { SuppressionService } from '../contacts/SuppressionService'
import type { SenderPolicy } from '../deliverability/SenderPolicy'
import type { RenderedEmail } from '../templates/TemplateRenderer'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import type { ProviderRegistry } from './ProviderRegistry'
import type { MessageHeaders, MessageTags } from './types'

export interface DeliveryRequest {
  messageId: string
  content: RenderedEmail
  /** When set, adds RFC 8058 one-click unsubscribe headers (required for bulk/marketing mail). */
  unsubscribeUrl?: string | null
  /** Extra headers (e.g. List-Id). */
  headers?: MessageHeaders
}

export type DeliveryOutcome =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'suppressed'; reason: SuppressionReason }
  | { status: 'failed'; error: string }

const ALREADY_SENT = new Set(['sent', 'delivered', 'delayed', 'bounced', 'complained'])

/**
 * Hands one of the organization's `messages` rows to its configured provider:
 * suppression check, compliance headers, correlation tags (incl. `organization_id`
 * for SES event routing), status bookkeeping, events and webhooks.
 * Retryable provider errors are re-thrown so the calling workflow step retries.
 * Only From addresses allowed by the organization's SenderPolicy are sent.
 */
export class MessageSender {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly providers: ProviderRegistry,
    private readonly suppressions: SuppressionService,
    private readonly webhooks: WebhookDispatcher,
    /** From addresses the organization may use (also checked by composers before queueing). */
    readonly senders: SenderPolicy
  ) {}

  async deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
    const [message] = await this.db
      .select()
      .from(messages)
      .where(this.messageById(request.messageId))

    if (!message) throw new NotFoundError('Message', request.messageId)

    if (ALREADY_SENT.has(message.status) && message.providerMessageId) {
      return { status: 'sent', providerMessageId: message.providerMessageId }
    }

    if (message.status === 'cancelled') return { status: 'failed', error: 'cancelled' }

    const reason = await this.suppressions.blockingReason(message.toEmail, message.kind)

    if (reason) {
      await this.db
        .update(messages)
        .set({
          status: 'suppressed',
          error: `Suppressed: ${reason}`,
          subject: request.content.subject
        })
        .where(this.messageById(message.id))
      await this.webhooks.dispatch('email.suppressed', {
        id: message.id,
        to: message.toEmail,
        reason,
        broadcastId: message.broadcastId
      })

      return { status: 'suppressed', reason }
    }

    const headers: MessageHeaders = { ...request.headers }

    if (request.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${request.unsubscribeUrl}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }

    const tags: MessageTags = {
      message_id: message.id,
      organization_id: this.scope.organizationId,
      kind: message.kind
    }

    if (message.broadcastId) tags.broadcast_id = message.broadcastId

    if (message.contactId) tags.contact_id = message.contactId

    await this.db
      .update(messages)
      .set({ status: 'sending', subject: request.content.subject })
      .where(this.messageById(message.id))
    const provider = await this.providers.email()
    let providerMessageId: string

    try {
      const verdict = await this.senders.check(message.fromEmail)

      if (!verdict.allowed) throw new ProviderError(verdict.reason, false)

      const accepted = await provider.send({
        from: message.fromEmail,
        to: message.toEmail,
        replyTo: message.replyTo,
        subject: request.content.subject,
        html: request.content.html,
        text: request.content.text,
        headers,
        tags
      })

      providerMessageId = accepted.providerMessageId
    } catch (cause) {
      const err =
        cause instanceof ProviderError
          ? cause
          : new ProviderError(
              cause instanceof Error ? cause.message : 'Unknown provider error',
              false
            )

      if (err.retryable) {
        await this.db
          .update(messages)
          .set({ status: 'queued', error: err.message })
          .where(this.messageById(message.id))
        throw err
      }

      await this.markFailed(message.id, err.message)

      return { status: 'failed', error: err.message }
    }

    // The provider accepted the email: from here on it is never marked failed.
    // A bookkeeping error propagates (the message stays `sending`), the webhook is best effort.
    const sentAt = new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({
          status: 'sent',
          providerMessageId: providerMessageId || null,
          sentAt,
          error: null
        })
        .where(this.messageById(message.id))
      await tx.insert(emailEvents).values(
        this.scope.values({
          messageId: message.id,
          contactId: message.contactId,
          broadcastId: message.broadcastId,
          type: 'send' as const,
          occurredAt: sentAt,
          data: { provider: provider.id, providerMessageId }
        })
      )
    })

    try {
      await this.webhooks.dispatch('email.sent', {
        id: message.id,
        to: message.toEmail,
        subject: request.content.subject,
        broadcastId: message.broadcastId
      })
    } catch (cause) {
      console.error('[email] failed to dispatch email.sent webhook', message.id, cause)
    }

    return { status: 'sent', providerMessageId }
  }

  /** Permanent failure bookkeeping (also used when retries are exhausted). */
  async markFailed(messageId: string, error: string) {
    const [message] = await this.db
      .update(messages)
      .set({ status: 'failed', error })
      .where(this.messageById(messageId))
      .returning()

    if (!message) return
    await this.db.insert(emailEvents).values(
      this.scope.values({
        messageId: message.id,
        contactId: message.contactId,
        broadcastId: message.broadcastId,
        type: 'failed' as const,
        data: { error }
      })
    )
    await this.webhooks.dispatch('email.failed', {
      id: message.id,
      to: message.toEmail,
      error,
      broadcastId: message.broadcastId
    })
  }

  private messageById(id: string) {
    return and(this.scope.eq(messages.organizationId), eq(messages.id, id))
  }
}
