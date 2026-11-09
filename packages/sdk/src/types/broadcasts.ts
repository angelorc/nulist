import type { PageParams } from './common'

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'sent'
  | 'cancelled'
  | 'failed'

/** Index filters: `sending` includes paused broadcasts, `cancelled` includes failed ones. */
export type BroadcastListFilter = 'all' | 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'

export interface BroadcastAudience {
  listIds: string[]
  segmentIds: string[]
  excludeListIds: string[]
}

export interface BroadcastUtm {
  enabled: boolean
  source?: string
  medium?: string
  campaign?: string
}

export interface BroadcastSummary {
  id: string
  object: 'broadcast'
  name: string
  subject: string
  preheader: string | null
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
  templateId: string | null
  topicId: string | null
  status: BroadcastStatus
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  recipientCount: number
  createdAt: string
  updatedAt: string
}

export interface BroadcastStats {
  recipients: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  /** Unique opens / delivered. */
  openRate: number
  /** Unique clicks / delivered. */
  clickRate: number
}

/** A broadcast as listed by `broadcasts.list`. */
export interface BroadcastListItem extends BroadcastSummary {
  stats: BroadcastStats
}

export interface Broadcast extends BroadcastSummary {
  audience: BroadcastAudience
  utm: BroadcastUtm
}

/** Message counts of a broadcast. */
export interface BroadcastProgress {
  recipients: number
  /** Waiting to be handed to the provider. */
  pending: number
  sent: number
  failed: number
  suppressed: number
  cancelled: number
}

/** A broadcast with its sending progress (`broadcasts.get`). */
export interface BroadcastDetail extends Broadcast {
  progress: BroadcastProgress
}

export interface BroadcastAudienceOptions {
  listIds?: string[]
  segmentIds?: string[]
  /** Contacts of these lists are left out. */
  excludeListIds?: string[]
}

export interface BroadcastUtmOptions {
  enabled?: boolean
  source?: string
  medium?: string
  campaign?: string
}

/** Fields of a draft; `null` or `''` clears an optional one. */
export interface UpdateBroadcastOptions {
  name?: string
  subject?: string
  preheader?: string | null
  fromName?: string | null
  fromEmail?: string | null
  replyTo?: string | null
  /** A marketing template of the organization. */
  templateId?: string | null
  topicId?: string | null
  audience?: BroadcastAudienceOptions
  utm?: BroadcastUtmOptions
}

/** Every field is optional: a draft can be completed later with `broadcasts.update`. */
export type CreateBroadcastOptions = UpdateBroadcastOptions

export interface SendBroadcastOptions {
  /** ISO 8601 date-time with offset (at most a year ahead); omit or null to send now. */
  scheduledAt?: string | null
}

export interface ListBroadcastsOptions extends PageParams {
  /** Matches the name or subject. */
  q?: string
  status?: BroadcastListFilter
}
