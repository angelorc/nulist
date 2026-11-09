import { z } from 'zod'
import type { PermissionRequest } from '../auth/permissions'
import type { JsonObject, JsonValue } from '../types/domain'
import { WEBHOOK_EVENTS } from '../utils/webhook-events'
import type { WebhookEventType } from '../utils/webhook-events'

const EVENT_TYPES = WEBHOOK_EVENTS.map((e) => e.type)

const webhookEventTypeSchema = z.enum(EVENT_TYPES)

/** Whether a stored event name is one this version knows (older rows may hold removed ones). */
export function isWebhookEventType(value: string): value is WebhookEventType {
  return webhookEventTypeSchema.safeParse(value).success
}

const page = z.coerce.number().int().min(1).default(1)
const pageSize = z.coerce.number().int().min(1).max(200).default(25)

// ---------------------------------------------------------------------------
// Outbound endpoints
// ---------------------------------------------------------------------------

/** Fields without defaults, so `.partial()` never resets omitted fields on PATCH. */
const endpointFields = {
  url: z
    .url({ protocol: /^https?$/, error: 'Enter a valid http(s) URL' })
    .max(2048, 'URL is too long'),
  description: z.string().trim().max(200, 'Keep the description under 200 characters').nullish(),
  /** Empty array = every event, including ones added in the future. */
  events: z.array(webhookEventTypeSchema).max(EVENT_TYPES.length),
  enabled: z.boolean()
}

export const webhookEndpointInputSchema = z.object({
  ...endpointFields,
  events: endpointFields.events.default([]),
  enabled: endpointFields.enabled.default(true)
})

export const webhookEndpointUpdateSchema = z.object(endpointFields).partial()

export type WebhookEndpointInput = z.infer<typeof webhookEndpointInputSchema>

export type WebhookEndpointUpdate = z.infer<typeof webhookEndpointUpdateSchema>

/** Dashboard form: "all events" is an explicit choice instead of an empty list. */
export const webhookEndpointFormSchema = z
  .object({
    url: endpointFields.url,
    description: z.string().trim().max(200, 'Keep the description under 200 characters'),
    allEvents: z.boolean(),
    events: endpointFields.events
  })
  .refine((value) => value.allEvents || value.events.length > 0, {
    path: ['events'],
    message: 'Pick at least one event, or subscribe to all events'
  })

export type WebhookEndpointForm = z.infer<typeof webhookEndpointFormSchema>

export function endpointFormToInput(
  form: WebhookEndpointForm
): Required<Pick<WebhookEndpointInput, 'url' | 'description' | 'events'>> {
  return {
    url: form.url.trim(),
    description: form.description.trim() || null,
    events: form.allEvents ? [] : form.events
  }
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed'] as const

export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number]

export const webhookDeliveriesQuerySchema = z.object({
  page,
  pageSize,
  endpointId: z.uuid().optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional()
})

/** `GET /api/webhook-deliveries/[id]` as received by the browser. */
export interface WebhookDeliveryDetail {
  id: string
  endpointId: string
  eventType: string
  payload: JsonObject
  status: WebhookDeliveryStatus
  attempts: number
  responseStatus: number | null
  responseBody: string | null
  durationMs: number | null
  lastAttemptAt: string | null
  createdAt: string
  endpoint: { id: string; url: string; enabled: boolean }
}

/** A receiver's response body as JSON, when it is JSON. */
export function parseJsonBody(body: string | null | undefined): JsonValue | undefined {
  if (!body) return undefined

  try {
    const parsed = z.json().safeParse(JSON.parse(body))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Inbound (Amazon SES via SNS)
// ---------------------------------------------------------------------------
export const SES_EVENT_TYPES = [
  'Send',
  'Delivery',
  'Bounce',
  'Complaint',
  'Reject',
  'Open',
  'Click',
  'Rendering Failure',
  'DeliveryDelay',
  'Subscription'
] as const

export type SesEventTypeName = (typeof SES_EVENT_TYPES)[number]

const sesEventTypeSchema = z.enum(SES_EVENT_TYPES)

export const INBOUND_STATUSES = ['processed', 'ignored', 'failed'] as const

export const inboundEventsQuerySchema = z.object({
  page,
  pageSize,
  q: z.string().trim().max(200).optional(),
  eventType: sesEventTypeSchema.optional(),
  status: z.enum(INBOUND_STATUSES).optional()
})

export const SIMULATED_EVENT_TYPES = [
  'delivery',
  'bounce',
  'soft_bounce',
  'complaint',
  'open',
  'click'
] as const

export type SimulatedEventType = (typeof SIMULATED_EVENT_TYPES)[number]

export const simulateSesEventSchema = z.object({
  messageId: z.uuid('Enter a message ID'),
  type: z.enum(SIMULATED_EVENT_TYPES),
  link: z.url({ protocol: /^https?$/, error: 'Enter a valid http(s) URL' }).optional()
})

export type SimulateSesEventInput = z.infer<typeof simulateSesEventSchema>

/**
 * Simulated events really move message statuses, update contacts and suppress
 * addresses, so running one needs both (owners and admins).
 */
export const SIMULATE_SES_EVENT_PERMISSION = {
  webhook: ['update'],
  suppression: ['create']
} as const satisfies PermissionRequest

export const SIMULATED_EVENT_LABELS: Record<
  SimulatedEventType,
  { label: string; description: string }
> = {
  delivery: { label: 'Delivery', description: 'The recipient server accepted the email' },
  bounce: { label: 'Hard bounce', description: 'Permanent bounce: suppresses the address' },
  soft_bounce: {
    label: 'Soft bounce',
    description: 'Transient bounce: counts toward the threshold'
  },
  complaint: { label: 'Complaint', description: 'Marked as spam: suppresses and unsubscribes' },
  open: { label: 'Open', description: 'The recipient opened the email' },
  click: { label: 'Click', description: 'The recipient clicked a link' }
}

export const SES_EVENT_LABELS: Record<SesEventTypeName, string> = {
  Send: 'Send',
  Delivery: 'Delivery',
  Bounce: 'Bounce',
  Complaint: 'Complaint',
  Reject: 'Reject',
  Open: 'Open',
  Click: 'Click',
  'Rendering Failure': 'Rendering failure',
  DeliveryDelay: 'Delivery delay',
  Subscription: 'Subscription'
}

/** Human label for an inbound log row (SES event type, or the SNS message type). */
export function inboundEventLabel(event: { type: string; eventType: string | null }): string {
  const sesEventType = sesEventTypeSchema.safeParse(event.eventType)

  if (sesEventType.success) return SES_EVENT_LABELS[sesEventType.data]

  switch (event.type) {
    case 'SubscriptionConfirmation':
      return 'Subscription confirmation'
    case 'UnsubscribeConfirmation':
      return 'Unsubscribe confirmation'
    case 'Notification':
      return 'Notification'
    default:
      return event.eventType ?? event.type
  }
}

/** Row of `GET /api/inbound-events` as received by the browser. */
export interface InboundEventListItem {
  id: string
  snsMessageId: string
  type: string
  eventType: string | null
  topicArn: string | null
  status: (typeof INBOUND_STATUSES)[number]
  error: string | null
  recipient: string | null
  createdAt: string
}

/** `GET /api/inbound-events/[id]` as received by the browser. */
export interface InboundEventDetail extends InboundEventListItem {
  payload: JsonObject
  /** nulist message the event refers to (our `message_id` SES tag), when present. */
  messageId: string | null
}
