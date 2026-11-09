import type { SegmentField, SegmentFieldType, SegmentOperator } from '../types/domain'

export interface SegmentFieldDefinition {
  field: SegmentField
  label: string
  type: SegmentFieldType
  operators: SegmentOperator[]
  options?: { label: string; value: string }[]
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
    field: 'engagement',
    label: 'Engagement',
    type: 'engagement',
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
  not_clicked_within_days: 'has not clicked in the last (days)'
}

/** Operators that do not take a value. */
export const VALUELESS_OPERATORS: SegmentOperator[] = ['is_set', 'is_not_set']

export function segmentFieldDefinition(field: SegmentField): SegmentFieldDefinition {
  return SEGMENT_FIELDS.find((f) => f.field === field) ?? SEGMENT_FIELDS[0]!
}
