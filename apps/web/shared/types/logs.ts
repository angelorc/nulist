import type { EmailEventType, JsonObject, JsonValue, MessageKind, MessageStatus } from './domain'

/** Relative time window used by log filters. */
export type LogPeriod = '24h' | '7d' | '30d' | '90d'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx'

export type InboundStatus = 'processed' | 'ignored' | 'failed'

export type ActorType = 'user' | 'api_key' | 'system'

export type EmailOutcome = 'delivered' | 'in_flight' | 'issues' | 'skipped'

export interface LogVolumePoint {
  at: string
  ok: number
  issues: number
  other: number
}

export type EmailEngagement = 'clicked' | 'opened' | 'none'

/** The time window a stats or facet response covers (ISO instants; `period` when a preset). */
export interface LogWindowRange {
  from: string
  to: string
  period: LogPeriod | null
}

export interface LogStats<F extends string> {
  total: number
  facets: Record<F, number>
  volume: LogVolumePoint[]
  bucket: 'hour' | 'day'
  window: LogWindowRange
  lastAt: string | null
}

/** One value of a facet with the number of entries it would match (disjunctive count). */
export interface FacetBucket {
  value: string
  label: string | null
  count: number
}

export type FacetCounts<K extends string> = Record<K, FacetBucket[]>

export type EmailFacetKey = 'status' | 'kind' | 'engagement' | 'broadcastId'

export type ApiFacetKey = 'status' | 'method' | 'apiKeyId'

export type InboundFacetKey = 'status' | 'eventType'

export type AuditFacetKey = 'actorType' | 'entityType' | 'action'

export interface EmailLogFacets {
  facets: FacetCounts<EmailFacetKey>
  /** Labels for the pinned entity filters of the query (`contactId`, `templateId`). */
  scope: {
    contact: { id: string; email: string } | null
    template: { id: string; name: string } | null
  }
}

export interface ApiLogFacets {
  facets: FacetCounts<ApiFacetKey>
}

export interface InboundEventFacets {
  facets: FacetCounts<InboundFacetKey>
}

export interface AuditFacets {
  facets: FacetCounts<AuditFacetKey>
}

export type EmailLogStats = LogStats<EmailOutcome>

export interface ApiLogStats extends LogStats<StatusClass> {
  p95Ms: number | null
}

export interface InboundEventStats extends LogStats<InboundStatus> {
  types: { type: string; count: number }[]
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------
export interface EmailLogItem {
  id: string
  kind: MessageKind
  status: MessageStatus
  toEmail: string
  subject: string
  broadcast: { id: string; name: string } | null
  openCount: number
  clickCount: number
  error: string | null
  createdAt: string
  sentAt: string | null
}

export interface EmailEventItem {
  id: number
  type: EmailEventType
  occurredAt: string
  /** The provider's event detail (SES notification fields), as stored. */
  data: JsonObject
}

export interface EmailLogDetail extends EmailLogItem {
  fromEmail: string
  replyTo: string | null
  html: string | null
  /** Where `html` comes from: stored on the message, or the broadcast snapshot (personalized for preview). */
  htmlSource: 'message' | 'broadcast' | null
  text: string | null
  tags: Record<string, string>
  variables: JsonObject | null
  providerMessageId: string | null
  idempotencyKey: string | null
  runId: string | null
  apiKeyId: string | null
  scheduledAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  updatedAt: string
  contact: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    attributes: JsonObject
  } | null
  template: { id: string; name: string } | null
  events: EmailEventItem[]
}

// ---------------------------------------------------------------------------
// API requests
// ---------------------------------------------------------------------------
export interface ApiLogItem {
  id: number
  method: string
  path: string
  statusCode: number
  durationMs: number
  apiKey: { id: string; name: string | null; start: string | null } | null
  ip: string | null
  createdAt: string
}

export interface ApiLogDetail extends ApiLogItem {
  userAgent: string | null
  /** Recorded (redacted, truncated) JSON payloads; `null` when none was recorded. */
  requestBody: JsonValue | null
  responseBody: JsonValue | null
}

// ---------------------------------------------------------------------------
// Inbound provider events (SNS → SES)
// ---------------------------------------------------------------------------
export interface InboundEventItem {
  id: string
  snsMessageId: string
  type: string
  eventType: string | null
  topicArn: string | null
  status: InboundStatus
  error: string | null
  createdAt: string
  recipient: string | null
  detail: string | null
  message: { id: string; subject: string } | null
}

export interface InboundEventDetail extends InboundEventItem {
  /** The SNS envelope as received. */
  payload: JsonObject
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export interface AuditLogItem {
  id: number
  actorType: ActorType
  actorId: string | null
  actorLabel: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string
  changes: JsonObject | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}
