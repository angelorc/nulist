import { z } from 'zod'
import type { EmailEventType, JsonObject, MessageStatus } from '../types/domain'

/** How long an `Idempotency-Key` stays bound to the first request that used it. */
export const IDEMPOTENCY_WINDOW_HOURS = 24

/** Largest batch accepted by `POST /api/v1/emails/batch`. */
export const MAX_BATCH_SIZE = 100

/** How far ahead an email can be scheduled. */
export const MAX_SCHEDULE_DAYS = 30

const MAILBOX = /^\s*(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+)>\s*$/

/** An address with its optional display name. */
export interface Mailbox {
  name: string | null
  email: string
}

/** Splits `"Acme" <hello@acme.com>` (or a bare address) into its parts. */
export function parseMailbox(value: string): Mailbox {
  const match = MAILBOX.exec(value)

  if (match) return { name: match[1]?.trim() || null, email: (match[2] ?? '').trim() }

  return { name: null, email: value.trim() }
}

const addressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'))

/** A bare address or an RFC 5322 mailbox such as `Acme <hello@acme.com>`. */
export const mailboxSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .refine(
    (value) => z.email().safeParse(parseMailbox(value).email).success,
    'Use an email address or "Name <email@example.com>"'
  )

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, 'Idempotency-Key must not be empty')
  .max(256, 'Idempotency-Key must be at most 256 characters')

/** Custom tags stored with the message (searchable metadata, not sent to the recipient). */
export const emailTagsSchema = z
  .record(
    z.string().regex(/^[\w-]{1,64}$/, 'Tag names use letters, numbers, "_" and "-" (max 64)'),
    z.string().max(256, 'Tag values are at most 256 characters')
  )
  .refine((tags) => Object.keys(tags).length <= 20, 'At most 20 tags per email')

/** Liquid variables exposed as `{{ data.<key> }}` (any JSON; stored with the message). */
export const emailDataSchema = z
  .record(z.string(), z.json())
  .refine(
    (data) => JSON.stringify(data).length <= 65_536,
    'data must be at most 64 KB once serialized'
  )

const emailFields = {
  to: addressSchema,
  from: mailboxSchema.optional(),
  replyTo: addressSchema.optional(),
  subject: z.string().trim().min(1, 'Subject must not be empty').max(998).optional(),
  /** Template id or slug. */
  template: z.string().trim().min(1).max(120).optional(),
  html: z
    .string()
    .min(1, 'html must not be empty')
    .max(512_000, 'html must be at most 500 KB')
    .optional(),
  text: z.string().max(256_000).optional(),
  data: emailDataSchema.optional(),
  tags: emailTagsSchema.optional(),
  topicId: z.uuid('topicId must be a UUID').optional(),
  scheduledAt: z.iso
    .datetime({
      offset: true,
      error: 'scheduledAt must be an ISO 8601 date-time, e.g. 2026-05-01T09:00:00Z'
    })
    .optional()
}

function refineContent(
  value: { template?: string; html?: string; subject?: string; scheduledAt?: string },
  ctx: z.RefinementCtx
) {
  if (value.template && value.html) {
    ctx.addIssue({
      code: 'custom',
      path: ['html'],
      message: 'Send either a template or html, not both'
    })
  }

  if (!value.template && !value.html) {
    ctx.addIssue({
      code: 'custom',
      path: ['template'],
      message: 'Provide a template (id or slug), or html and a subject'
    })
  }

  if (value.html && !value.subject) {
    ctx.addIssue({
      code: 'custom',
      path: ['subject'],
      message: 'subject is required when sending html'
    })
  }

  if (
    value.scheduledAt &&
    new Date(value.scheduledAt).getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['scheduledAt'],
      message: `Emails can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead`
    })
  }
}

/** One email in `POST /api/v1/emails` and in each batch item. */
export const transactionalEmailSchema = z.object(emailFields).superRefine(refineContent)

export type TransactionalEmailInput = z.infer<typeof transactionalEmailSchema>

/** Service input: the request body plus the `Idempotency-Key` header. */
export interface TransactionalSendInput extends TransactionalEmailInput {
  idempotencyKey?: string | null
}

/** Accepts `[...]` or `{ "emails": [...] }`. */
export const transactionalBatchSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { emails: value } : value),
  z.object({
    emails: z
      .array(transactionalEmailSchema)
      .min(1, 'Send at least one email')
      .max(MAX_BATCH_SIZE, `A batch holds at most ${MAX_BATCH_SIZE} emails`)
  })
)

export type TransactionalBatchInput = z.infer<typeof transactionalBatchSchema>

// ---------------------------------------------------------------------------
// Resources returned by the API
// ---------------------------------------------------------------------------

/** Stable public representation of a transactional email (REST API v1). */
export interface TransactionalEmail {
  id: string
  object: 'email'
  status: MessageStatus
  to: string
  from: string
  replyTo: string | null
  subject: string
  templateId: string | null
  topicId: string | null
  tags: Record<string, string>
  error: string | null
  scheduledAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  createdAt: string
}

export interface TransactionalEmailEvent {
  type: EmailEventType
  occurredAt: string
  data: JsonObject
}

export interface TransactionalEmailDetail extends TransactionalEmail {
  events: TransactionalEmailEvent[]
}

/** Result of a send: the email plus whether it replayed an earlier request with the same Idempotency-Key. */
export interface TransactionalSendResult {
  email: TransactionalEmail
  replayed: boolean
}

export interface TransactionalBatchResult {
  object: 'list'
  data: TransactionalEmail[]
}

export interface TransactionalBatchSendResult {
  batch: TransactionalBatchResult
  /** True when every email replayed an earlier request with the same Idempotency-Key. */
  replayed: boolean
}

// ---------------------------------------------------------------------------
// Dashboard overview
// ---------------------------------------------------------------------------

/** Message counts by status within a window (only non-zero statuses are present). */
export type StatusCounts = Partial<Record<MessageStatus, number>>

export interface TransactionalWindow {
  total: number
  /** Handed to the provider (sent, delivered, delayed, bounced, complained). */
  sent: number
  delivered: number
  bounced: number
  failed: number
  byStatus: StatusCounts
}

export interface TransactionalRecentEmail {
  id: string
  to: string
  subject: string
  status: MessageStatus
  template: { id: string; name: string } | null
  error: string | null
  createdAt: string
}

export interface TransactionalTemplateItem {
  id: string
  name: string
  slug: string | null
  subject: string
  updatedAt: string
  /** Emails rendered from this template in the last 7 days. */
  sent7d: number
}

/** REST API traffic in a window (from `api_logs`). */
export interface ApiTrafficSummary {
  total: number
  /** Responses with status 400 or above. */
  errors: number
  /** Median latency in milliseconds (null without requests). */
  p50Ms: number | null
}

export interface TransactionalOverview {
  last24h: TransactionalWindow
  /** The 24 hours before `last24h`, for deltas. */
  previous24h: TransactionalWindow
  last7d: TransactionalWindow
  recent: TransactionalRecentEmail[]
  templates: TransactionalTemplateItem[]
  /** API requests in the last 24 hours. */
  api: ApiTrafficSummary
}
