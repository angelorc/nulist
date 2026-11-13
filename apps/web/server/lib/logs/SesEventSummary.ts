import { z } from 'zod'
import { SesEventParser } from '../events/SesEvent'
import type { SesEvent, SesEventOf } from '../events/SesEvent'

export interface SesEventFacts {
  recipient: string | null
  messageId: string | null
  detail: string | null
}

const NONE: SesEventFacts = { recipient: null, messageId: null, detail: null }

const messageIdSchema = z.uuid()

const looseMailSchema = z.object({
  mail: z
    .object({
      destination: z.array(z.string()).catch([]),
      tags: z.record(z.string(), z.array(z.string())).catch({})
    })
    .catch({ destination: [], tags: {} })
})

export class SesEventSummary {
  constructor(private readonly parser = new SesEventParser()) {}

  read(message: string | null): SesEventFacts {
    if (!message) return NONE
    const notification = this.parser.parse(message)

    if (notification.kind === 'event') {
      return { ...this.identify(notification.event), detail: this.describe(notification.event) }
    }

    const loose = looseMailSchema.safeParse(notification.payload)

    return loose.success ? { ...this.identify(loose.data), detail: null } : NONE
  }

  private identify(event: {
    mail: { destination: string[]; tags: Record<string, string[]> }
  }): Omit<SesEventFacts, 'detail'> {
    const taggedId = messageIdSchema.safeParse(event.mail.tags.message_id?.[0])

    return {
      recipient: event.mail.destination[0] ?? null,
      messageId: taggedId.success ? taggedId.data : null
    }
  }

  private describeBounce(bounce: SesEventOf<'Bounce'>['bounce']): string {
    const kind = bounce.bounceType === 'Transient' ? 'Soft bounce' : 'Hard bounce'
    const diagnostic = bounce.bouncedRecipients[0]?.diagnosticCode

    return [`${kind} · ${bounce.bounceSubType}`, diagnostic].filter(Boolean).join(' — ')
  }

  private describe(event: SesEvent): string | null {
    switch (event.eventType) {
      case 'Send':
        return 'Accepted by Amazon SES'
      case 'Delivery':
        return event.delivery.smtpResponse ?? 'Delivered to the recipient server'
      case 'Bounce':
        return this.describeBounce(event.bounce)
      case 'Complaint':
        return `Marked as spam${event.complaint.complaintFeedbackType ? ` · ${event.complaint.complaintFeedbackType}` : ''}`
      case 'Reject':
        return event.reject.reason ?? 'Rejected by Amazon SES'
      case 'Open':
        return event.open.isBotEvent ? 'Opened by an automated client' : 'Opened'
      case 'Click':
        return event.click.link
      case 'Rendering Failure':
        return event.failure.errorMessage ?? 'The template could not be rendered'
      case 'DeliveryDelay':
        return `Delayed · ${event.deliveryDelay.delayType}`
      case 'Subscription':
        return 'Subscription preferences changed'
    }
  }
}
