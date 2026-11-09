import type { AudienceDefinition, BroadcastStatus, MessageStatus, UtmSettings } from './domain'

/**
 * Wire shapes of the broadcasts feature (dates are ISO strings once serialized).
 * Server code returns the equivalent row types with `Date` values.
 */

export interface BroadcastDto {
  id: string
  name: string
  subject: string
  preheader: string | null
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
  templateId: string | null
  topicId: string | null
  audience: AudienceDefinition
  utm: UtmSettings
  status: BroadcastStatus
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  recipientCount: number
  runId: string | null
  createdAt: string
  updatedAt: string
}

/** Message counts of a broadcast, grouped for progress reporting. */
export interface BroadcastProgress {
  recipients: number
  /** Waiting to be handed to the provider (queued, scheduled or in flight). */
  pending: number
  sent: number
  failed: number
  suppressed: number
  cancelled: number
}

export interface BroadcastDetail extends BroadcastDto {
  template: {
    id: string
    name: string
    kind: 'marketing' | 'transactional'
    updatedAt: string
  } | null
  topic: { id: string; name: string } | null
  progress: BroadcastProgress
  /** Last successful test send (null when none). */
  lastTestAt: string | null
  /** Campaign used for UTM tagging when `utm.campaign` is empty. */
  defaultCampaign: string
}

export interface BroadcastListStats {
  recipients: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  /** Unique opens / delivered (estimate: Apple Mail Privacy Protection inflates it). */
  openRate: number
  /** Unique clicks / delivered. */
  clickRate: number
}

export interface BroadcastListItem extends Omit<BroadcastDto, 'audience' | 'utm' | 'runId'> {
  stats: BroadcastListStats
}

/** Index page filter tabs. `sending` includes paused, `cancelled` includes failed. */
export type BroadcastTab = 'all' | 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'

export type BroadcastTabCounts = Record<BroadcastTab, number>

// ---------------------------------------------------------------------------
// Pre-flight checklist
// ---------------------------------------------------------------------------
export type ChecklistStatus = 'ok' | 'warning' | 'blocker'

export type ChecklistKey =
  | 'audience'
  | 'sender'
  | 'sending'
  | 'subject'
  | 'template'
  | 'unsubscribe'
  | 'preheader'
  | 'address'
  | 'test'
  | 'capacity'

export interface ChecklistItem {
  key: ChecklistKey
  label: string
  status: ChecklistStatus
  detail: string
}

export interface BroadcastPreflight {
  items: ChecklistItem[]
  /** Live recipient estimate for the current audience. */
  recipients: number
  /** No blockers: the broadcast can be scheduled or sent. */
  ready: boolean
  /** Estimated sending time in seconds at the configured rate. */
  durationSeconds: number
  ratePerSecond: number
  /** Last successful test send (ISO), null when none. */
  lastTestAt: string | null
}

// ---------------------------------------------------------------------------
// Composer helpers
// ---------------------------------------------------------------------------
/** Audience sources offered by the composer ("To" field). */
export interface AudienceListOption {
  id: string
  name: string
  confirmedCount: number
}

export interface AudienceSegmentOption {
  id: string
  name: string
  contactCount: number | null
}

export interface BroadcastPreview {
  subject: string
  html: string
  /** Problems found while rendering (empty when the preview is faithful). */
  issues: string[]
}

export interface BroadcastEstimate {
  count: number
}

export interface BroadcastTestDelivery {
  email: string
  messageId: string | null
  status: 'sent' | 'suppressed' | 'failed'
  /** Whether a real contact with this address was used to render the email. */
  personalized: boolean
  error?: string
}

export interface BroadcastTestResult {
  results: BroadcastTestDelivery[]
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
/** Recipient filter on the report: message statuses plus engagement shortcuts. */
export type BroadcastRecipientFilter =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'cancelled'

export interface BroadcastRecipient {
  messageId: string
  contactId: string | null
  email: string
  firstName: string | null
  lastName: string | null
  status: MessageStatus
  error: string | null
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  openCount: number
  clickCount: number
}

// ---------------------------------------------------------------------------
// Durable sending (workflow step payloads: plain serializable data)
// ---------------------------------------------------------------------------
export interface BroadcastSendPlan {
  status: BroadcastStatus
  /** ISO time to sleep until before starting, null to start now. */
  sleepUntil: string | null
  batchSize: number
}

export type BroadcastBeginState = 'sending' | 'paused' | 'cancelled' | 'finished'

export interface BroadcastBeginResult {
  state: BroadcastBeginState
  recipients: number
}

export type BroadcastBatchState =
  | 'continue'
  | 'done'
  | 'paused'
  | 'cancelled'
  | 'limited'
  | 'throttled'

export interface BroadcastBatchResult {
  sent: number
  failed: number
  suppressed: number
  remaining: number
  state: BroadcastBatchState
}

export interface BroadcastCompletion {
  status: BroadcastStatus
  recipients: number
  sent: number
  failed: number
  suppressed: number
}
