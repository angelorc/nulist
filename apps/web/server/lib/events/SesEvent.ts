import { z } from 'zod'
import { SES_EVENT_TYPES } from '../../../shared/schemas/webhooks'
import type { JsonObject } from '../../../shared/types/domain'

/**
 * Typed model of Amazon SES event publishing payloads (configuration set →
 * SNS event destination). Schemas are loose: unknown fields are kept, only
 * the fields nulist relies on are validated.
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
 */

const tagsSchema = z.record(z.string(), z.array(z.string()))

export const sesMailSchema = z.looseObject({
  timestamp: z.string(),
  messageId: z.string(),
  source: z.string().optional(),
  destination: z.array(z.string()).default([]),
  sendingAccountId: z.string().optional(),
  headersTruncated: z.boolean().optional(),
  headers: z.array(z.looseObject({ name: z.string(), value: z.string() })).optional(),
  commonHeaders: z
    .looseObject({
      from: z.array(z.string()).optional(),
      to: z.array(z.string()).optional(),
      subject: z.string().optional(),
      messageId: z.string().optional()
    })
    .optional(),
  /** SES message tags; every value is an array. */
  tags: tagsSchema.default({})
})

const recipientSchema = z.looseObject({
  emailAddress: z.string(),
  action: z.string().optional(),
  status: z.string().optional(),
  diagnosticCode: z.string().optional()
})

export const sesBounceSchema = z.looseObject({
  bounceType: z.enum(['Undetermined', 'Permanent', 'Transient']),
  bounceSubType: z.string(),
  bouncedRecipients: z.array(recipientSchema).default([]),
  timestamp: z.string().optional(),
  feedbackId: z.string().optional(),
  reportingMTA: z.string().optional(),
  remoteMtaIp: z.string().optional()
})

export const sesComplaintSchema = z.looseObject({
  complainedRecipients: z.array(z.looseObject({ emailAddress: z.string() })).default([]),
  timestamp: z.string().optional(),
  feedbackId: z.string().optional(),
  complaintSubType: z.string().nullish(),
  complaintFeedbackType: z.string().optional(),
  userAgent: z.string().optional(),
  arrivalDate: z.string().optional()
})

export const sesDeliverySchema = z.looseObject({
  timestamp: z.string().optional(),
  processingTimeMillis: z.number().optional(),
  recipients: z.array(z.string()).default([]),
  smtpResponse: z.string().optional(),
  reportingMTA: z.string().optional(),
  remoteMtaIp: z.string().optional()
})

export const sesRejectSchema = z.looseObject({ reason: z.string().optional() })

export const sesOpenSchema = z.looseObject({
  timestamp: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  isBotEvent: z.boolean().optional()
})

export const sesClickSchema = z.looseObject({
  timestamp: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  link: z.string(),
  linkTags: tagsSchema.optional(),
  isBotEvent: z.boolean().optional()
})

export const sesRenderingFailureSchema = z.looseObject({
  templateName: z.string().optional(),
  errorMessage: z.string().optional()
})

export const sesDeliveryDelaySchema = z.looseObject({
  delayType: z.string(),
  expirationTime: z.string().optional(),
  delayedRecipients: z.array(recipientSchema).default([]),
  timestamp: z.string().optional(),
  reportingMTA: z.string().optional()
})

export const sesSubscriptionSchema = z.looseObject({
  contactList: z.string().optional(),
  timestamp: z.string().optional(),
  source: z.string().optional()
})

export const sesEventSchema = z.discriminatedUnion('eventType', [
  z.looseObject({
    eventType: z.literal('Send'),
    mail: sesMailSchema,
    send: z.looseObject({}).default({})
  }),
  z.looseObject({
    eventType: z.literal('Delivery'),
    mail: sesMailSchema,
    delivery: sesDeliverySchema
  }),
  z.looseObject({ eventType: z.literal('Bounce'), mail: sesMailSchema, bounce: sesBounceSchema }),
  z.looseObject({
    eventType: z.literal('Complaint'),
    mail: sesMailSchema,
    complaint: sesComplaintSchema
  }),
  z.looseObject({ eventType: z.literal('Reject'), mail: sesMailSchema, reject: sesRejectSchema }),
  z.looseObject({ eventType: z.literal('Open'), mail: sesMailSchema, open: sesOpenSchema }),
  z.looseObject({ eventType: z.literal('Click'), mail: sesMailSchema, click: sesClickSchema }),
  z.looseObject({
    eventType: z.literal('Rendering Failure'),
    mail: sesMailSchema,
    failure: sesRenderingFailureSchema
  }),
  z.looseObject({
    eventType: z.literal('DeliveryDelay'),
    mail: sesMailSchema,
    deliveryDelay: sesDeliveryDelaySchema
  }),
  z.looseObject({
    eventType: z.literal('Subscription'),
    mail: sesMailSchema,
    subscription: sesSubscriptionSchema
  })
])

export type SesEvent = z.infer<typeof sesEventSchema>

export type SesEventType = SesEvent['eventType']

export type SesMail = z.infer<typeof sesMailSchema>

export type SesEventOf<T extends SesEventType> = Extract<SesEvent, { eventType: T }>

/** What an SNS `Message` turned out to be. `payload` is what the inbound log stores. */
export type SesNotification =
  | { kind: 'event'; event: SesEvent; payload: JsonObject }
  /** Valid JSON that is not an SES event (e.g. the `AmazonSnsSubscriptionSucceeded` notice). */
  | { kind: 'other'; payload: JsonObject }
  /** Malformed: not JSON, not an object, or an SES event missing required fields. */
  | { kind: 'invalid'; payload: JsonObject; eventType: string | null; reason: string }

const MAX_RAW_MESSAGE = 10_000

const jsonTextSchema = z.string().transform((text, ctx) => {
  try {
    return z.json().parse(JSON.parse(text))
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Message is not valid JSON' })

    return z.NEVER
  }
})

const jsonObjectSchema = z.record(z.string(), z.json())

/** Identity notifications (legacy `notificationType`) share the event shape. */
const eventTypeProbeSchema = z.looseObject({
  eventType: z.string().optional(),
  notificationType: z.string().optional()
})

const sesEventTypeSchema = z.enum(SES_EVENT_TYPES)

/** Turns the SNS `Message` string into a typed SES event, or says why it is not one. */
export class SesEventParser {
  parse(message: string): SesNotification {
    const json = jsonTextSchema.safeParse(message)

    if (!json.success) {
      return {
        kind: 'invalid',
        payload: { raw: message.slice(0, MAX_RAW_MESSAGE) },
        eventType: null,
        reason: 'Message is not valid JSON'
      }
    }

    const object = jsonObjectSchema.safeParse(json.data)

    if (!object.success) {
      return {
        kind: 'invalid',
        payload: { message: json.data },
        eventType: null,
        reason: 'Message is not a JSON object'
      }
    }

    const payload = object.data
    const probe = eventTypeProbeSchema.parse(payload)
    const claimed = probe.eventType ?? probe.notificationType ?? null
    const eventType = sesEventTypeSchema.safeParse(claimed)

    if (!eventType.success) return { kind: 'other', payload }
    const result = sesEventSchema.safeParse({ ...payload, eventType: eventType.data })

    if (!result.success) {
      const issue = result.error.issues[0]

      return {
        kind: 'invalid',
        payload,
        eventType: eventType.data,
        reason: `Invalid ${eventType.data} event${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`
      }
    }

    return { kind: 'event', event: result.data, payload }
  }

  /** Type guard helper for callers holding a generic event. */
  static is<T extends SesEventType>(event: SesEvent, type: T): event is SesEventOf<T> {
    return event.eventType === type
  }
}
