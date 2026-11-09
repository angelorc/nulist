import { eq } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { messages, organization } from '../../db/schema'
import type { JsonObject } from '../../../shared/types/domain'
import { DomainError } from '../core/errors'
import { toJsonObject } from '../core/json'
import { InboundEventLog } from './InboundEventLog'
import type { InboundOutcome, InboundSource } from './InboundEventLog'
import { SesEventParser } from './SesEvent'
import type { SesEvent, SesMail } from './SesEvent'
import type { SesEventApplier, SesMessageRow, SesOutcome } from './SesEventApplier'
import { SnsSubscriptionConfirmer, UntrustedSubscribeUrlError } from './SnsSubscriptionConfirmer'
import type { SubscriptionConfirmer } from './SnsSubscriptionConfirmer'
import type { SnsEnvelope } from './SnsVerifier'

export type SesProcessStatus = 'processed' | 'ignored' | 'failed'

export interface SesProcessResult {
  status: SesProcessStatus
  /** Why the event was ignored or failed (safe to show to members). */
  reason?: string
  /** mlist message the event was correlated with. */
  messageId?: string | null
  /** The failure is transient: the sender (SNS) should deliver the message again. */
  retryable?: boolean
}

/** What the router needs from an organization (its OrganizationContainer). */
export interface SesEventTenant {
  readonly sesEventApplier: SesEventApplier
}

/** Resolves an organization's services (the root Container). */
export interface SesEventTenants {
  forOrganization(organizationId: string): SesEventTenant
}

/** An outcome together with the organization it was applied in (null: instance-level). */
interface RoutedOutcome extends SesOutcome {
  organizationId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INTERNAL_ERROR = 'Internal error while processing the event'

/**
 * Instance-wide router of Amazon SES events (delivered through one SNS
 * endpoint for every organization). For each delivery it deduplicates on the
 * SNS MessageId (inbound log), finds the message globally (our `message_id`
 * tag, then the SES message id) and applies the event in the message's
 * organization through that organization's SesEventApplier, all in one
 * transaction. Webhooks go to that organization after commit. Tags are set by
 * whoever sends through SES, so they never decide on their own which
 * organization's contacts an event touches: events without a message of ours
 * are logged and ignored.
 */
export class SesEventProcessor {
  readonly inbound: InboundEventLog
  protected readonly parser = new SesEventParser()
  protected confirmer: SubscriptionConfirmer = new SnsSubscriptionConfirmer()

  constructor(
    protected readonly db: Database,
    protected readonly tenants: SesEventTenants
  ) {
    this.inbound = new InboundEventLog(db)
  }

  // ---------------------------------------------------------------------------
  // Entry points
  // ---------------------------------------------------------------------------

  /** Handles one verified SNS delivery. */
  async handle(envelope: SnsEnvelope): Promise<SesProcessResult> {
    switch (envelope.Type) {
      case 'SubscriptionConfirmation':
        return this.confirmSubscription(envelope)
      case 'UnsubscribeConfirmation': {
        const recorded = await this.inbound.record(
          this.sourceOf(envelope, this.envelopePayload(envelope)),
          null,
          { status: 'ignored', error: 'The SNS subscription was removed' }
        )

        return {
          status: 'ignored',
          reason: recorded ? 'Unsubscribe confirmation' : 'Duplicate SNS message'
        }
      }

      case 'Notification':
        return this.handleNotification(envelope)
    }
  }

  /**
   * Applies an already parsed SES event. With a `source`, the event is also
   * recorded in the inbound log and deduplicated on its SNS MessageId.
   */
  async process(event: SesEvent, source?: InboundSource): Promise<SesProcessResult> {
    let outcome: RoutedOutcome

    try {
      outcome = await this.db.transaction(async (tx) => {
        const claimId = source ? await this.inbound.claim(tx, source, event.eventType) : null

        if (source && !claimId) {
          return {
            status: 'ignored',
            reason: 'Duplicate SNS message',
            messageId: null,
            organizationId: null,
            webhooks: []
          } satisfies RoutedOutcome
        }

        const routed = await this.route(tx, event)

        if (claimId) {
          await this.inbound.complete(tx, claimId, {
            status: routed.status,
            error: routed.status === 'ignored' ? (routed.reason ?? null) : null,
            organizationId: routed.organizationId
          })
        }

        return routed
      })
    } catch (error) {
      if (!(error instanceof DomainError)) console.error('[ses-events] processing failed', error)
      const reason = error instanceof DomainError ? error.message : INTERNAL_ERROR

      if (source) await this.recordFailedEvent(source, event, reason)

      return { status: 'failed', reason, retryable: true }
    }

    if (outcome.organizationId)
      await this.tenants
        .forOrganization(outcome.organizationId)
        .sesEventApplier.dispatch(outcome.webhooks)

    return { status: outcome.status, reason: outcome.reason, messageId: outcome.messageId }
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /** Finds the event's organization and applies the event there. */
  private async route(tx: Executor, event: SesEvent): Promise<RoutedOutcome> {
    // Never applied: attributed to the tagged organization without locking the message.
    if (event.eventType === 'Send' || event.eventType === 'Subscription') {
      const organizationId = await this.taggedOrganization(tx, event.mail)

      if (organizationId) return this.applyIn(tx, organizationId, event, null)

      return SesEventProcessor.unrouted(
        event.eventType === 'Send'
          ? 'Send events are recorded by mlist when the email is handed to SES'
          : 'SES subscription management events are not used'
      )
    }

    const message = await this.correlate(tx, event.mail)
    const tagged = await this.taggedOrganization(tx, event.mail)

    if (message && tagged && tagged !== message.organizationId) {
      console.warn(
        `[ses-events] organization_id tag ${tagged} does not match message ${message.id} (organization ${message.organizationId}); using the message's organization`
      )
    }

    if (!message) return SesEventProcessor.unrouted('Message not found (not sent by mlist)')

    return this.applyIn(tx, message.organizationId, event, message)
  }

  private async applyIn(
    tx: Executor,
    organizationId: string,
    event: SesEvent,
    message: SesMessageRow | null
  ): Promise<RoutedOutcome> {
    const { sesEventApplier } = this.tenants.forOrganization(organizationId)
    const outcome = await sesEventApplier.apply(tx, event, message)

    return { ...outcome, organizationId }
  }

  /**
   * Finds (and locks) the mlist message across every organization: our
   * `message_id` tag first, then the SES message id. A tagged message that SES
   * already identified under another message id is not this event's message.
   */
  private async correlate(tx: Executor, mail: SesMail): Promise<SesMessageRow | null> {
    const tagged = mail.tags.message_id?.[0]

    if (tagged && UUID.test(tagged)) {
      const [row] = await tx.select().from(messages).where(eq(messages.id, tagged)).for('update')

      const sameMessage =
        !row?.providerMessageId || !mail.messageId || row.providerMessageId === mail.messageId

      if (row && sameMessage) return row
    }

    if (mail.messageId) {
      const [row] = await tx
        .select()
        .from(messages)
        .where(eq(messages.providerMessageId, mail.messageId))
        .for('update')

      if (row) return row
    }

    return null
  }

  /** Our `organization_id` SES tag, when it names an existing organization. */
  private async taggedOrganization(executor: Executor, mail: SesMail): Promise<string | null> {
    const tagged = mail.tags.organization_id?.[0]

    if (!tagged || !UUID.test(tagged)) return null

    const [row] = await executor
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, tagged))

    return row?.id ?? null
  }

  /**
   * Records a failed attempt (SNS delivers it again), attributed to the tagged
   * organization when known. Best effort: the database may be what failed.
   */
  private async recordFailedEvent(
    source: InboundSource,
    event: SesEvent,
    reason: string
  ): Promise<void> {
    try {
      const organizationId = await this.taggedOrganization(this.db, event.mail)

      await this.inbound.record(source, event.eventType, {
        status: 'failed',
        error: reason,
        organizationId
      })
    } catch (cause) {
      console.error('[ses-events] could not record a failed event', cause)
    }
  }

  // ---------------------------------------------------------------------------
  // SNS message types (instance-level: no organization)
  // ---------------------------------------------------------------------------

  private async handleNotification(envelope: SnsEnvelope): Promise<SesProcessResult> {
    const notification = this.parser.parse(envelope.Message)

    switch (notification.kind) {
      case 'event':
        return this.process(notification.event, this.sourceOf(envelope, notification.payload))
      case 'other': {
        const recorded = await this.inbound.record(
          this.sourceOf(envelope, notification.payload),
          null,
          { status: 'ignored', error: 'Not an SES event' }
        )

        return {
          status: 'ignored',
          reason: recorded ? 'Not an SES event' : 'Duplicate SNS message'
        }
      }

      case 'invalid':
        return this.recordFailure(envelope, notification.payload, notification.eventType, {
          status: 'failed',
          error: notification.reason
        })
    }
  }

  private async confirmSubscription(envelope: SnsEnvelope): Promise<SesProcessResult> {
    const source = this.sourceOf(envelope, this.envelopePayload(envelope))

    if (await this.inbound.isHandled(envelope.MessageId))
      return { status: 'ignored', reason: 'Duplicate SNS message' }
    const url = envelope.SubscribeURL

    if (!url || !SnsSubscriptionConfirmer.isTrusted(url)) {
      await this.inbound.record(source, null, {
        status: 'failed',
        error: 'SubscribeURL does not point to an Amazon SNS endpoint'
      })

      return { status: 'failed', reason: 'Untrusted SubscribeURL', retryable: false }
    }

    try {
      await this.confirmer.confirm(url)
    } catch (error) {
      const untrusted = error instanceof UntrustedSubscribeUrlError

      const reason = untrusted
        ? error.message
        : `Subscription confirmation failed: ${error instanceof Error ? error.message : 'unknown error'}`

      await this.inbound.record(source, null, { status: 'failed', error: reason })

      return { status: 'failed', reason, retryable: !untrusted }
    }

    await this.inbound.record(source, null, { status: 'processed' })

    return { status: 'processed', reason: 'Subscription confirmed' }
  }

  private async recordFailure(
    envelope: SnsEnvelope,
    payload: JsonObject,
    eventType: string | null,
    outcome: InboundOutcome
  ): Promise<SesProcessResult> {
    await this.inbound.record(this.sourceOf(envelope, payload), eventType, outcome)

    // Malformed payloads will not get better on redelivery.
    return { status: 'failed', reason: outcome.error ?? undefined, retryable: false }
  }

  private sourceOf(envelope: SnsEnvelope, payload: JsonObject): InboundSource {
    return {
      snsMessageId: envelope.MessageId,
      type: envelope.Type,
      topicArn: envelope.TopicArn || null,
      payload
    }
  }

  /** Envelope without signature material, for the inbound log. */
  private envelopePayload(envelope: SnsEnvelope): JsonObject {
    return toJsonObject({
      Type: envelope.Type,
      MessageId: envelope.MessageId,
      TopicArn: envelope.TopicArn,
      Message: envelope.Message,
      Timestamp: envelope.Timestamp,
      SubscribeURL: envelope.SubscribeURL
    })
  }

  private static unrouted(reason: string): RoutedOutcome {
    return { status: 'ignored', reason, messageId: null, organizationId: null, webhooks: [] }
  }
}
