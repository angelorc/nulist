import type {
  SegmentActivityEvent,
  SegmentActivityScope,
  SegmentField,
  SegmentFieldType,
  SegmentGroupMatch,
  SegmentOperator,
  SegmentRules
} from '../types/domain'

export interface SegmentFieldDefinition {
  field: SegmentField
  label: string
  type: SegmentFieldType
  operators: SegmentOperator[]
  options?: { label: string; value: string }[]
  legacy?: boolean
}

const TEXT_OPERATORS: SegmentOperator[] = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_set',
  'is_not_set'
]

const DATE_OPERATORS: SegmentOperator[] = [
  'within_days',
  'not_within_days',
  'before',
  'after',
  'is_set',
  'is_not_set'
]

export const SEGMENT_FIELDS: SegmentFieldDefinition[] = [
  { field: 'email', label: 'Email', type: 'text', operators: TEXT_OPERATORS },
  { field: 'first_name', label: 'First name', type: 'text', operators: TEXT_OPERATORS },
  { field: 'last_name', label: 'Last name', type: 'text', operators: TEXT_OPERATORS },
  { field: 'source', label: 'Source', type: 'text', operators: TEXT_OPERATORS },
  {
    field: 'status',
    label: 'Status',
    type: 'enum',
    operators: ['eq', 'neq'],
    options: ['active', 'unsubscribed', 'bounced', 'complained', 'blocklisted'].map((v) => ({
      label: v,
      value: v
    }))
  },
  { field: 'created_at', label: 'Created', type: 'date', operators: DATE_OPERATORS },
  { field: 'last_opened_at', label: 'Last opened', type: 'date', operators: DATE_OPERATORS },
  { field: 'last_clicked_at', label: 'Last clicked', type: 'date', operators: DATE_OPERATORS },
  { field: 'list', label: 'List membership', type: 'list', operators: ['in_list', 'not_in_list'] },
  {
    field: 'segment',
    label: 'Segment',
    type: 'segment',
    operators: ['in_segment', 'not_in_segment']
  },
  {
    field: 'topic',
    label: 'Topic',
    type: 'topic',
    operators: ['subscribed_topic', 'unsubscribed_topic']
  },
  { field: 'activity', label: 'Email activity', type: 'activity', operators: ['has', 'has_not'] },
  {
    field: 'engagement',
    label: 'Engagement',
    type: 'engagement',
    legacy: true,
    operators: [
      'opened_within_days',
      'not_opened_within_days',
      'clicked_within_days',
      'not_clicked_within_days'
    ]
  },
  {
    field: 'attribute',
    label: 'Custom attribute',
    type: 'attribute',
    operators: [...TEXT_OPERATORS, 'gt', 'lt']
  }
]

export const SEGMENT_OPERATOR_LABELS: Record<SegmentOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_set: 'is set',
  is_not_set: 'is not set',
  gt: 'greater than',
  lt: 'less than',
  before: 'before',
  after: 'after',
  within_days: 'in the last (days)',
  not_within_days: 'not in the last (days)',
  in_list: 'is in list',
  not_in_list: 'is not in list',
  opened_within_days: 'opened in the last (days)',
  not_opened_within_days: 'has not opened in the last (days)',
  clicked_within_days: 'clicked in the last (days)',
  not_clicked_within_days: 'has not clicked in the last (days)',
  in_segment: 'is in segment',
  not_in_segment: 'is not in segment',
  subscribed_topic: 'is subscribed to',
  unsubscribed_topic: 'is not subscribed to',
  has: 'has',
  has_not: 'has not'
}

/** Operators that do not take a value. */
export const VALUELESS_OPERATORS: SegmentOperator[] = ['is_set', 'is_not_set']

export function segmentFieldDefinition(field: SegmentField): SegmentFieldDefinition {
  return SEGMENT_FIELDS.find((f) => f.field === field) ?? SEGMENT_FIELDS[0]!
}

export interface SegmentActivityEventDefinition {
  value: SegmentActivityEvent
  label: string
  verb: string
  preposition?: string
}

export const SEGMENT_ACTIVITY_EVENTS: SegmentActivityEventDefinition[] = [
  { value: 'sent', label: 'Sent', verb: 'been sent' },
  { value: 'delivered', label: 'Delivered', verb: 'received' },
  { value: 'opened', label: 'Opened', verb: 'opened' },
  { value: 'clicked', label: 'Clicked', verb: 'clicked', preposition: 'in' },
  { value: 'bounced', label: 'Bounced', verb: 'bounced', preposition: 'on' },
  { value: 'complained', label: 'Complained', verb: 'complained', preposition: 'about' },
  { value: 'unsubscribed', label: 'Unsubscribed', verb: 'unsubscribed', preposition: 'from' }
]

export const SEGMENT_ACTIVITY_SCOPES: { value: SegmentActivityScope; label: string }[] = [
  { value: 'any', label: 'any email' },
  { value: 'broadcast', label: 'a broadcast' },
  { value: 'transactional', label: 'a transactional email' }
]

export const SEGMENT_GROUP_MATCH_LABELS: Record<SegmentGroupMatch, string> = {
  all: 'All',
  any: 'Any',
  none: 'None'
}

export function segmentActivityEventDefinition(
  event: SegmentActivityEvent
): SegmentActivityEventDefinition {
  return SEGMENT_ACTIVITY_EVENTS.find((e) => e.value === event) ?? SEGMENT_ACTIVITY_EVENTS[0]!
}

export interface SegmentPreset {
  id: string
  label: string
  description: string
  icon: string
  rules: SegmentRules
}

export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    id: 'engaged',
    label: 'Engaged',
    description: 'Opened any email in the last 30 days',
    icon: 'i-lucide-flame',
    rules: {
      match: 'all',
      conditions: [
        {
          field: 'activity',
          operator: 'has',
          event: 'opened',
          scope: 'any',
          times: 1,
          days: 30
        }
      ]
    }
  },
  {
    id: 'unengaged',
    label: 'Unengaged (sunset)',
    description: 'Sent at least 3 broadcasts in the last 90 days without opening any of them',
    icon: 'i-lucide-moon',
    rules: {
      match: 'all',
      conditions: [
        {
          field: 'activity',
          operator: 'has',
          event: 'sent',
          scope: 'broadcast',
          broadcastId: null,
          times: 3,
          days: 90
        },
        {
          field: 'activity',
          operator: 'has_not',
          event: 'opened',
          scope: 'broadcast',
          broadcastId: null,
          days: 90
        }
      ]
    }
  },
  {
    id: 'never-opened',
    label: 'Never opened',
    description: 'Has been sent an email but never opened one',
    icon: 'i-lucide-mail-x',
    rules: {
      match: 'all',
      conditions: [
        { field: 'activity', operator: 'has_not', event: 'opened', scope: 'any', days: null },
        {
          field: 'activity',
          operator: 'has',
          event: 'sent',
          scope: 'any',
          times: 1,
          days: null
        }
      ]
    }
  },
  {
    id: 'new-contacts',
    label: 'New contacts',
    description: 'Created in the last 7 days',
    icon: 'i-lucide-user-plus',
    rules: {
      match: 'all',
      conditions: [{ field: 'created_at', operator: 'within_days', value: 7 }]
    }
  },
  {
    id: 'recent-clickers',
    label: 'Recent clickers',
    description: 'Clicked a link in the last 30 days',
    icon: 'i-lucide-mouse-pointer-click',
    rules: {
      match: 'all',
      conditions: [
        {
          field: 'activity',
          operator: 'has',
          event: 'clicked',
          scope: 'any',
          times: 1,
          days: 30
        }
      ]
    }
  },
  {
    id: 'transactional-only',
    label: 'Transactional only',
    description: 'Received a transactional email and was never sent a broadcast',
    icon: 'i-lucide-receipt',
    rules: {
      match: 'all',
      conditions: [
        {
          field: 'activity',
          operator: 'has',
          event: 'delivered',
          scope: 'transactional',
          templateId: null,
          times: 1,
          days: null
        },
        {
          field: 'activity',
          operator: 'has_not',
          event: 'sent',
          scope: 'broadcast',
          broadcastId: null,
          days: null
        }
      ]
    }
  }
]
