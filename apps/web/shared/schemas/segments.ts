import { z } from 'zod'
import type { SegmentCondition, SegmentField, SegmentOperator, SegmentRules } from '../types/domain'
import {
  SEGMENT_FIELDS,
  SEGMENT_OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  segmentFieldDefinition
} from '../utils/segments'

/** Custom attribute keys: letters, digits, `_`, `.`, `-` (bound as a parameter, never interpolated). */
export const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
export const MAX_SEGMENT_CONDITIONS = 50
export const MAX_SEGMENT_DAYS = 36_500
export const MAX_SEGMENT_TEXT = 500

const FIELD_KEYS: SegmentField[] = SEGMENT_FIELDS.map((f) => f.field)

/** Every operator some field accepts (field/operator compatibility is checked per condition). */
const OPERATOR_KEYS: SegmentOperator[] = [...new Set(SEGMENT_FIELDS.flatMap((f) => f.operators))]

/** The value of a condition as stored or edited, before it is normalized for its kind. */
export type SegmentConditionValue = SegmentCondition['value']

/** The kind of value an operator expects for a given field — drives validation, SQL and the UI input. */
export type SegmentValueKind = 'none' | 'text' | 'option' | 'days' | 'date' | 'list' | 'number'

export function segmentValueKind(field: SegmentField, operator: SegmentOperator): SegmentValueKind {
  if (VALUELESS_OPERATORS.includes(operator)) return 'none'

  switch (segmentFieldDefinition(field).type) {
    case 'enum':
      return 'option'
    case 'list':
      return 'list'
    case 'engagement':
      return 'days'
    case 'date':
      return operator === 'before' || operator === 'after' ? 'date' : 'days'
    case 'attribute':
      return operator === 'gt' || operator === 'lt' ? 'number' : 'text'
    case 'number':
      return 'number'
    default:
      return 'text'
  }
}

/** Sensible starting value when a condition switches to a new value kind. */
export function defaultSegmentValue(
  kind: SegmentValueKind,
  field: SegmentField
): string | number | null {
  switch (kind) {
    case 'days':
      return 30
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'option':
      return segmentFieldDefinition(field).options?.[0]?.value ?? null
    case 'text':
      return ''
    default:
      return null
  }
}

/** A condition with the first operator of the field and its default value. */
export function newSegmentCondition(field: SegmentField = 'email'): SegmentCondition {
  const operator = segmentFieldDefinition(field).operators[0]!

  const condition: SegmentCondition = {
    field,
    operator,
    value: defaultSegmentValue(segmentValueKind(field, operator), field)
  }

  if (field === 'attribute') condition.key = ''

  return condition
}

/** Ids of the lists referenced by `in list` / `not in list` conditions (unique, in order). */
export function segmentListIds(rules: SegmentRules): string[] {
  const ids = rules.conditions.flatMap((condition) =>
    segmentFieldDefinition(condition.field).type === 'list' && condition.value
      ? [String(condition.value)]
      : []
  )

  return [...new Set(ids)]
}

type NormalizedValue = string | number | null

type ValueResult = { ok: true; value: NormalizedValue } | { ok: false; message: string }

const DECIMAL_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const DAYS_MESSAGE = `Enter a whole number of days between 1 and ${MAX_SEGMENT_DAYS}`

/** A number, or a string holding a plain decimal literal (inputs bind numbers as text). */
function numericValue(message: string) {
  return z.union([z.number(), z.string().trim().regex(DECIMAL_PATTERN).transform(Number)], {
    error: message
  })
}

/** Validation and normalization of a condition value, per value kind (`option` depends on the field). */
const VALUE_SCHEMAS: Record<Exclude<SegmentValueKind, 'option'>, z.ZodType<NormalizedValue>> = {
  none: z.unknown().transform(() => null),
  text: z
    .union([z.number().transform(String), z.string()], { error: 'Enter a value' })
    .pipe(
      z
        .string()
        .trim()
        .min(1, 'Enter a value')
        .max(MAX_SEGMENT_TEXT, `Use at most ${MAX_SEGMENT_TEXT} characters`)
    ),
  days: numericValue(DAYS_MESSAGE).pipe(
    z.int({ error: DAYS_MESSAGE }).min(1, DAYS_MESSAGE).max(MAX_SEGMENT_DAYS, DAYS_MESSAGE)
  ),
  date: z.iso.date({ error: 'Pick a date' }),
  list: z.uuid({ error: 'Choose a list' }),
  number: numericValue('Enter a number')
}

function valueSchema(kind: SegmentValueKind, field: SegmentField): z.ZodType<NormalizedValue> {
  if (kind !== 'option') return VALUE_SCHEMAS[kind]

  const options = (segmentFieldDefinition(field).options ?? []).map((o) => o.value)

  return z.literal(options, { error: 'Choose a value' })
}

/** Validates and normalizes the value of a condition for its value kind. */
function normalizeValue(
  kind: SegmentValueKind,
  field: SegmentField,
  raw: SegmentConditionValue
): ValueResult {
  const result = valueSchema(kind, field).safeParse(raw)

  if (result.success) return { ok: true, value: result.data }

  return { ok: false, message: result.error.issues[0]?.message ?? 'Enter a valid value' }
}

/**
 * One segment condition. Validates field/operator compatibility, the attribute key
 * and the value type, then normalizes it (trimmed text, integer days, numbers…).
 */
export const segmentConditionSchema = z
  .object({
    field: z.literal(FIELD_KEYS, { error: 'Choose a property' }),
    operator: z.literal(OPERATOR_KEYS, { error: 'Choose an operator' }),
    key: z.string().max(200).nullish(),
    value: z.union([z.string().max(MAX_SEGMENT_TEXT * 2), z.number()]).nullish()
  })
  .strict()
  .transform((input, ctx): SegmentCondition => {
    const definition = segmentFieldDefinition(input.field)

    if (!definition.operators.includes(input.operator)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: `"${SEGMENT_OPERATOR_LABELS[input.operator]}" is not available for ${definition.label.toLowerCase()}`
      })

      return z.NEVER
    }

    let key: string | undefined

    if (input.field === 'attribute') {
      key = (input.key ?? '').trim()

      if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['key'],
          message: key ? 'Use letters, digits, ".", "_" or "-" (max 64)' : 'Enter an attribute key'
        })

        return z.NEVER
      }
    }

    const result = normalizeValue(
      segmentValueKind(input.field, input.operator),
      input.field,
      input.value
    )

    if (!result.ok) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: result.message })

      return z.NEVER
    }

    const condition: SegmentCondition = {
      field: input.field,
      operator: input.operator,
      value: result.value
    }

    if (key !== undefined) condition.key = key

    return condition
  })

export const segmentRulesSchema = z
  .object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z
      .array(segmentConditionSchema)
      .max(
        MAX_SEGMENT_CONDITIONS,
        `A segment can have at most ${MAX_SEGMENT_CONDITIONS} conditions`
      )
      .default([])
  })
  .strict() satisfies z.ZodType<SegmentRules>

export const segmentInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish(),
  rules: segmentRulesSchema
})

export type SegmentInput = z.output<typeof segmentInputSchema>

/** Loose form state accepted by the schema (UI editors). */
export type SegmentInputState = z.input<typeof segmentInputSchema>

export type SegmentConditionState = z.input<typeof segmentConditionSchema>

export const segmentUpdateSchema = segmentInputSchema.partial()

export const segmentCountSchema = z.object({ rules: segmentRulesSchema })

export const segmentContactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional()
})

// ---------------------------------------------------------------------------
// Human readable summary ("Email contains “acme” and created in the last 30 days")
// ---------------------------------------------------------------------------
export interface SegmentDescribeContext {
  /** Resolves a list id to its name (unknown lists render as "a deleted list"). */
  listName?: (id: string) => string | undefined
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function quote(value: SegmentConditionValue) {
  return `“${String(value ?? '')}”`
}

function dayCount(value: SegmentConditionValue) {
  const n = Number(value)

  return `${n} ${n === 1 ? 'day' : 'days'}`
}

export function describeSegmentCondition(
  condition: SegmentCondition,
  context: SegmentDescribeContext = {}
): string {
  const definition = segmentFieldDefinition(condition.field)
  const operator = condition.operator

  const subject =
    condition.field === 'attribute' ? `Attribute ${condition.key ?? ''}` : definition.label

  const operatorLabel = SEGMENT_OPERATOR_LABELS[operator]

  switch (segmentValueKind(condition.field, operator)) {
    case 'none':
      return `${subject} ${operatorLabel}`
    case 'list': {
      const name = condition.value ? context.listName?.(String(condition.value)) : undefined

      return `${operator === 'in_list' ? 'In list' : 'Not in list'} ${name ? quote(name) : 'a deleted list'}`
    }

    case 'days': {
      if (definition.type === 'engagement') {
        const verb = operator.includes('opened') ? 'opened' : 'clicked'

        return operator.startsWith('not_')
          ? `Has not ${verb} in the last ${dayCount(condition.value)}`
          : `${verb[0]!.toUpperCase()}${verb.slice(1)} in the last ${dayCount(condition.value)}`
      }

      return `${subject} ${operator === 'not_within_days' ? 'not ' : ''}in the last ${dayCount(condition.value)}`
    }

    case 'date': {
      const date = new Date(`${String(condition.value)}T00:00:00Z`)

      return `${subject} ${operatorLabel} ${Number.isNaN(date.getTime()) ? String(condition.value) : dateFormatter.format(date)}`
    }

    case 'option':
      return `${subject} ${operatorLabel} ${String(condition.value)}`
    default:
      return `${subject} ${operatorLabel} ${quote(condition.value)}`
  }
}

/** One sentence describing the rules; empty rules match every contact. */
export function describeSegmentRules(
  rules: SegmentRules,
  context: SegmentDescribeContext = {}
): string {
  if (!rules.conditions.length) return 'All contacts'

  const parts = rules.conditions.map((c, i) => {
    const text = describeSegmentCondition(c, context)

    return i === 0 ? text : `${text[0]!.toLowerCase()}${text.slice(1)}`
  })

  const joiner = rules.match === 'all' ? 'and' : 'or'

  if (parts.length === 1) return parts[0]!

  return `${parts.slice(0, -1).join(', ')} ${joiner} ${parts.at(-1)}`
}
