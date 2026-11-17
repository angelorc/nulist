import type { ContactStatus } from './contacts'
import type { PageParams } from './common'

export type SegmentField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'source'
  | 'status'
  | 'created_at'
  | 'last_opened_at'
  | 'last_clicked_at'
  | 'list'
  | 'engagement'
  | 'attribute'
  | 'segment'
  | 'topic'
  | 'activity'

export type SegmentOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_set'
  | 'is_not_set'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'within_days'
  | 'not_within_days'
  | 'in_list'
  | 'not_in_list'
  | 'opened_within_days'
  | 'not_opened_within_days'
  | 'clicked_within_days'
  | 'not_clicked_within_days'
  | 'in_segment'
  | 'not_in_segment'
  | 'subscribed_topic'
  | 'unsubscribed_topic'
  | 'has'
  | 'has_not'

export type SegmentActivityEvent =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'

export type SegmentActivityScope = 'any' | 'broadcast' | 'transactional'

export interface SegmentFieldCondition {
  field: Exclude<SegmentField, 'activity'>
  operator: SegmentOperator
  key?: string
  value?: string | number | null
}

export interface SegmentActivityTag {
  key: string
  value: string
}

export interface SegmentActivityCondition {
  field: 'activity'
  operator: 'has' | 'has_not'
  event: SegmentActivityEvent
  scope: SegmentActivityScope
  broadcastId?: string | null
  templateId?: string | null
  tag?: SegmentActivityTag | null
  link?: string | null
  times?: number
  days?: number | null
}

export type SegmentCondition = SegmentFieldCondition | SegmentActivityCondition

export type SegmentGroupMatch = 'all' | 'any' | 'none'

export interface SegmentGroup {
  match: SegmentGroupMatch
  conditions: SegmentCondition[]
}

export type SegmentNode = SegmentCondition | SegmentGroup

export interface SegmentRules {
  match: 'all' | 'any'
  conditions: SegmentNode[]
}

export interface Segment {
  id: string
  object: 'segment'
  name: string
  description: string | null
  rules: SegmentRules
  summary: string
  contactCount: number | null
  createdAt: string
  updatedAt: string
}

export interface SegmentContact {
  id: string
  object: 'contact'
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  createdAt: string
}

export interface ListSegmentContactsOptions extends PageParams {
  q?: string
}
