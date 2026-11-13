import { z } from 'zod'
import { paginationSchema } from './pagination'

/**
 * Query schemas for the observability endpoints (logs, audit, analytics).
 * Imported by API handlers and the logs UI; services receive the parsed, typed values.
 */

export const LOG_PERIODS = ['24h', '7d', '30d', '90d'] as const

export const EMAIL_ENGAGEMENTS = ['clicked', 'opened', 'none'] as const

export const ACTOR_TYPES = ['user', 'api_key', 'system'] as const

export const INBOUND_STATUSES = ['processed', 'ignored', 'failed'] as const

/** Longest custom date range a query may ask for. */
export const MAX_RANGE_DAYS = 366

/** `a,b,c` in the query string (or a repeated key) as a non-empty list. */
function listOf<T extends z.ZodType<unknown, string>>(item: T) {
  const list = z.array(item).min(1).max(50)

  return z
    .union([
      z
        .string()
        .transform((value) => value.split(',').filter(Boolean))
        .pipe(list),
      list
    ])
    .optional()
}

/**
 * Time filter shared by every log and analytics query: a preset `period`, or a custom
 * `from`/`to` range of whole UTC days (both inclusive, `YYYY-MM-DD`).
 */
export const dateRangeQuerySchema = z.object({
  period: z.enum(LOG_PERIODS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
})

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>

export const MESSAGE_STATUSES = [
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'failed',
  'rejected',
  'suppressed',
  'cancelled'
] as const

export const EMAIL_OUTCOMES = ['delivered', 'in_flight', 'issues', 'skipped'] as const

export const EMAIL_OUTCOME_STATUSES = {
  delivered: ['delivered', 'sent'],
  in_flight: ['queued', 'scheduled', 'sending', 'delayed'],
  issues: ['bounced', 'complained', 'failed', 'rejected'],
  skipped: ['suppressed', 'cancelled']
} as const satisfies Record<
  (typeof EMAIL_OUTCOMES)[number],
  readonly (typeof MESSAGE_STATUSES)[number][]
>

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const

export const SES_EVENT_TYPES = [
  'Send',
  'Delivery',
  'DeliveryDelay',
  'Bounce',
  'Complaint',
  'Reject',
  'Open',
  'Click',
  'Rendering Failure',
  'Subscription'
] as const

export const emailLogQuerySchema = paginationSchema.extend({
  ...dateRangeQuerySchema.shape,
  status: listOf(z.enum(MESSAGE_STATUSES)),
  outcome: z.enum(EMAIL_OUTCOMES).optional(),
  kind: listOf(z.enum(['broadcast', 'transactional', 'system'])),
  engagement: listOf(z.enum(EMAIL_ENGAGEMENTS)),
  broadcastId: listOf(z.uuid()),
  contactId: z.uuid().optional(),
  templateId: z.uuid().optional(),
  recipient: z.string().trim().min(1).max(320).optional()
})

export type EmailLogQuery = z.infer<typeof emailLogQuerySchema>

export const apiLogQuerySchema = paginationSchema.extend({
  ...dateRangeQuerySchema.shape,
  method: listOf(z.enum(HTTP_METHODS)),
  status: listOf(z.enum(STATUS_CLASSES)),
  apiKeyId: listOf(z.uuid())
})

export type ApiLogQuery = z.infer<typeof apiLogQuerySchema>

export const inboundEventQuerySchema = paginationSchema.extend({
  ...dateRangeQuerySchema.shape,
  status: listOf(z.enum(INBOUND_STATUSES)),
  eventType: listOf(z.enum(SES_EVENT_TYPES)),
  recipient: z.string().trim().min(1).max(320).optional()
})

export type InboundEventQuery = z.infer<typeof inboundEventQuerySchema>

export const auditQuerySchema = paginationSchema.extend({
  ...dateRangeQuerySchema.shape,
  entityType: listOf(z.string().trim().min(1).max(64)),
  entityId: z.string().trim().min(1).max(128).optional(),
  actorType: listOf(z.enum(ACTOR_TYPES)),
  action: listOf(z.string().trim().min(1).max(64))
})

export const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
})

export const uuidParamSchema = z.object({ id: z.uuid() })

export const serialParamSchema = z.object({
  id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})

/** A recorded JSON payload (API request and response bodies); anything else reads as none. */
export const recordedBodySchema = z.json().nullable().catch(null)

/** `?id=` deep link to one log or audit entry: missing, empty or repeated values select nothing. */
export const selectedEntrySchema = z.string().min(1).optional().catch(undefined)

/** SNS delivers the SES event as a JSON string in `Message`. */
export const snsNotificationSchema = z.object({ Message: z.string() })

const detailText = z.string().min(1).optional().catch(undefined)

/**
 * The fields of a provider event (SES detail as stored in `email_events.data`)
 * that the email timeline describes. Missing or malformed fields read as absent;
 * the raw event stays available as data.
 */
export const emailEventDetailsSchema = z.object({
  provider: detailText,
  smtpResponse: detailText,
  userAgent: detailText,
  link: detailText,
  click: z.object({ link: detailText }).optional().catch(undefined),
  bounceType: detailText,
  bounceSubType: detailText,
  diagnosticCode: detailText,
  feedbackType: detailText,
  complaintFeedbackType: detailText,
  reason: detailText,
  delayType: detailText,
  errorMessage: detailText,
  source: detailText,
  error: detailText
})

export type EmailEventDetails = z.infer<typeof emailEventDetailsSchema>
