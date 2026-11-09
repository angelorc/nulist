import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { messages } from '../../db/schema'
import type { SimulateSesEventInput } from '../../../shared/schemas/webhooks'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { InvalidStateError, NotFoundError } from '../core/errors'
import { toJsonObject } from '../core/json'
import type { InboundSource } from './InboundEventLog'
import type { SesEvent, SesMail } from './SesEvent'
import type { SesEventProcessor, SesProcessResult } from './SesEventProcessor'
import type { TenantScope } from '../core/TenantScope'

type MessageRow = typeof messages.$inferSelect

const SIMULATOR_TOPIC = 'arn:aws:sns:local:000000000000:nulist-simulator'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

/**
 * Builds realistic SES event payloads for a message of the organization, so
 * the whole event pipeline (statuses, suppressions, webhooks, analytics) can be
 * exercised without an AWS account. The event goes through the platform router
 * with the same tags MessageSender sets, so it is correlated and routed back to
 * this organization exactly like a real one.
 */
export class SesEventSimulator {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly router: SesEventProcessor,
    private readonly audit: AuditLogger
  ) {}

  /** Builds the event and runs it through the real router (recorded in the inbound log). */
  async simulate(
    input: SimulateSesEventInput,
    actor: Actor
  ): Promise<SesProcessResult & { eventType: SesEvent['eventType'] }> {
    const { event, source } = await this.build(input)
    const result = await this.router.process(event, source)
    await this.audit.log(actor, {
      action: 'ses_event.simulated',
      entityType: 'message',
      entityId: input.messageId,
      summary: `Simulated an SES ${event.eventType.toLowerCase()} event (${result.status})`,
      changes: { type: { from: null, to: input.type } }
    })

    return { ...result, eventType: event.eventType }
  }

  async build(input: SimulateSesEventInput): Promise<{ event: SesEvent; source: InboundSource }> {
    const [message] = await this.db
      .select()
      .from(messages)
      .where(and(this.scope.eq(messages.organizationId), eq(messages.id, input.messageId)))

    if (!message) throw new NotFoundError('Message', input.messageId)

    if (!['sent', 'delivered', 'delayed', 'bounced', 'complained'].includes(message.status)) {
      throw new InvalidStateError(
        `Only sent messages can receive provider events (this one is ${message.status})`
      )
    }

    const event = this.event(message, input)

    const source: InboundSource = {
      snsMessageId: `simulated-${randomUUID()}`,
      type: 'Simulation',
      topicArn: SIMULATOR_TOPIC,
      payload: toJsonObject(event)
    }

    return { event, source }
  }

  private event(message: MessageRow, input: SimulateSesEventInput): SesEvent {
    const mail = this.mail(message)
    const now = new Date().toISOString()
    const recipient = { emailAddress: message.toEmail }

    switch (input.type) {
      case 'delivery':
        return {
          eventType: 'Delivery',
          mail,
          delivery: {
            timestamp: now,
            processingTimeMillis: 912,
            recipients: [message.toEmail],
            smtpResponse: '250 2.0.0 OK  1731160000 simulated - gsmtp',
            reportingMTA: 'a8-30.smtp-out.amazonses.com',
            remoteMtaIp: '192.0.2.10'
          }
        }
      case 'bounce':
        return {
          eventType: 'Bounce',
          mail,
          bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'General',
            bouncedRecipients: [
              {
                ...recipient,
                action: 'failed',
                status: '5.1.1',
                diagnosticCode: 'smtp; 550 5.1.1 user unknown'
              }
            ],
            timestamp: now,
            feedbackId: this.feedbackId(),
            reportingMTA: 'dsn; a8-30.smtp-out.amazonses.com'
          }
        }
      case 'soft_bounce':
        return {
          eventType: 'Bounce',
          mail,
          bounce: {
            bounceType: 'Transient',
            bounceSubType: 'MailboxFull',
            bouncedRecipients: [
              {
                ...recipient,
                action: 'failed',
                status: '4.2.2',
                diagnosticCode: 'smtp; 452 4.2.2 mailbox full'
              }
            ],
            timestamp: now,
            feedbackId: this.feedbackId(),
            reportingMTA: 'dsn; a8-30.smtp-out.amazonses.com'
          }
        }
      case 'complaint':
        return {
          eventType: 'Complaint',
          mail,
          complaint: {
            complainedRecipients: [recipient],
            timestamp: now,
            feedbackId: this.feedbackId(),
            complaintSubType: null,
            complaintFeedbackType: 'abuse',
            userAgent: 'Yahoo!-Mail-Feedback/2.0',
            arrivalDate: now
          }
        }
      case 'open':
        return {
          eventType: 'Open',
          mail,
          open: { timestamp: now, ipAddress: '198.51.100.24', userAgent: USER_AGENT }
        }
      case 'click':
        return {
          eventType: 'Click',
          mail,
          click: {
            timestamp: now,
            ipAddress: '198.51.100.24',
            userAgent: USER_AGENT,
            link: input.link ?? 'https://example.com/',
            linkTags: { simulated: ['true'] }
          }
        }
    }
  }

  /** The SES mail object, with the tags MessageSender sets on real sends. */
  private mail(message: MessageRow): SesMail {
    const tags: [string, string[]][] = [
      ['message_id', [message.id]],
      ['organization_id', [message.organizationId]],
      ['kind', [message.kind]],
      ['ses:configuration-set', ['nulist']]
    ]

    if (message.broadcastId) tags.push(['broadcast_id', [message.broadcastId]])

    if (message.contactId) tags.push(['contact_id', [message.contactId]])

    return {
      timestamp: (message.sentAt ?? message.createdAt).toISOString(),
      messageId: message.providerMessageId ?? `simulated-${message.id}`,
      source: message.fromEmail,
      destination: [message.toEmail],
      sendingAccountId: '000000000000',
      commonHeaders: { from: [message.fromEmail], to: [message.toEmail], subject: message.subject },
      tags: Object.fromEntries(tags)
    }
  }

  private feedbackId(): string {
    return `${randomUUID().replace(/-/g, '')}-simulated-000000`
  }
}
