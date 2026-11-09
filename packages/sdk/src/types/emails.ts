import type { JsonInput, JsonObject } from '../core/json'
import type { PageParams } from './common'

export type EmailStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'rejected'
  | 'suppressed'
  | 'cancelled'

export type EmailEventType =
  | 'send'
  | 'delivery'
  | 'bounce'
  | 'complaint'
  | 'reject'
  | 'open'
  | 'click'
  | 'delivery_delay'
  | 'rendering_failure'
  | 'unsubscribe'
  | 'failed'

/** A transactional email. */
export interface Email {
  id: string
  object: 'email'
  status: EmailStatus
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

export interface EmailEvent {
  type: EmailEventType
  occurredAt: string
  /** The provider's event detail, as stored. */
  data: JsonObject
}

/** An email with its delivery events (`emails.get`). */
export interface EmailDetail extends Email {
  events: EmailEvent[]
}

/** The emails of a batch, in request order. */
export interface EmailBatch {
  object: 'list'
  data: Email[]
}

interface SendEmailCommonOptions {
  /** One recipient address; use `batch.send` for many. */
  to: string
  /** `"Acme <hello@acme.com>"` or a bare address; defaults to the organization's sender. */
  from?: string
  replyTo?: string
  /** Plain-text part; generated from the HTML when omitted. */
  text?: string
  /** Liquid variables, available as `{{ data.<key> }}` (at most 64 KB serialized). */
  data?: Record<string, JsonInput>
  /** Up to 20 tags; names use letters, numbers, `_` and `-`. */
  tags?: Record<string, string>
  /** Topic the recipient can opt out of. */
  topicId?: string
  /** ISO 8601 date-time with offset, at most 30 days ahead. */
  scheduledAt?: string
}

/** Rendered from a transactional template (id or slug); `subject` overrides the template's. */
export interface SendTemplateEmailOptions extends SendEmailCommonOptions {
  template: string
  subject?: string
  html?: never
}

/** Raw HTML (Liquid variables are rendered) with its subject. */
export interface SendHtmlEmailOptions extends SendEmailCommonOptions {
  html: string
  subject: string
  template?: never
}

export type SendEmailOptions = SendTemplateEmailOptions | SendHtmlEmailOptions

export interface ListEmailsOptions extends PageParams {
  status?: EmailStatus
}
