import { z } from 'zod'
import type {
  SegmentActivityCondition,
  SegmentCondition,
  SegmentField,
  SegmentFieldCondition,
  SegmentFieldType,
  SegmentGroup,
  SegmentNode,
  SegmentOperator,
  SegmentRules
} from '../types/domain'
import {
  SEGMENT_ACTIVITY_EVENTS,
  SEGMENT_ACTIVITY_SCOPES,
  SEGMENT_FIELDS,
  SEGMENT_OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  segmentActivityEventDefinition,
  segmentFieldDefinition
} from '../utils/segments'

/** Custom attribute keys: letters, digits, `_`, `.`, `-` (bound as a parameter, never interpolated). */
export const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
export const SEGMENT_TAG_KEY_PATTERN = /^[\w-]{1,64}$/
export const MAX_SEGMENT_CONDITIONS = 50
export const MAX_SEGMENT_GROUPS = 10
export const MAX_SEGMENT_DAYS = 36_500
export const MAX_SEGMENT_TEXT = 500
export const MAX_SEGMENT_TIMES = 1000
export const MAX_SEGMENT_TAG_VALUE = 256

type SegmentPropertyField = SegmentFieldCondition['field']

function isPropertyField(field: SegmentField): field is SegmentPropertyField {
  return field !== 'activity'
}

const FIELD_KEYS = SEGMENT_FIELDS.flatMap((f) => (isPropertyField(f.field) ? [f.field] : []))

/** Every operator some field accepts (field/operator compatibility is checked per condition). */
const OPERATOR_KEYS: SegmentOperator[] = [...new Set(SEGMENT_FIELDS.flatMap((f) => f.operators))]

const ACTIVITY_EVENT_KEYS = SEGMENT_ACTIVITY_EVENTS.map((e) => e.value)
const ACTIVITY_SCOPE_KEYS = SEGMENT_ACTIVITY_SCOPES.map((s) => s.value)

/** The value of a condition as stored or edited, before it is normalized for its kind. */
export type SegmentConditionValue = SegmentFieldCondition['value']

/** The kind of value an operator expects for a given field — drives validation, SQL and the UI input. */
export type SegmentValueKind =
  | 'none'
  | 'text'
  | 'option'
  | 'days'
  | 'date'
  | 'list'
  | 'number'
  | 'segment'
  | 'topic'
  | 'activity'

export function segmentValueKind(field: SegmentField, operator: SegmentOperator): SegmentValueKind {
  if (VALUELESS_OPERATORS.includes(operator)) return 'none'

  switch (segmentFieldDefinition(field).type) {
    case 'enum':
      return 'option'
    case 'list':
      return 'list'
    case 'segment':
      return 'segment'
    case 'topic':
      return 'topic'
    case 'activity':
      return 'activity'
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
  if (field === 'activity') {
    return {
      field: 'activity',
      operator: 'has',
      event: 'opened',
      scope: 'any',
      times: 1,
      days: 30
    }
  }

  const operator = segmentFieldDefinition(field).operators[0]!

  const condition: SegmentFieldCondition = {
    field,
    operator,
    value: defaultSegmentValue(segmentValueKind(field, operator), field)
  }

  if (field === 'attribute') condition.key = ''

  return condition
}

export function newSegmentGroup(): SegmentGroup {
  return { match: 'any', conditions: [newSegmentCondition('email')] }
}

export function isSegmentGroup(node: SegmentNode): node is SegmentGroup {
  return 'conditions' in node
}

export type SegmentPath = (string | number)[]

export interface SegmentConditionEntry {
  condition: SegmentCondition
  path: SegmentPath
}

export function segmentConditionEntries(rules: SegmentRules): SegmentConditionEntry[] {
  return rules.conditions.flatMap((node, index) =>
    isSegmentGroup(node)
      ? node.conditions.map((condition, inner) => ({
          condition,
          path: ['conditions', index, 'conditions', inner]
        }))
      : [{ condition: node, path: ['conditions', index] }]
  )
}

export interface SegmentReference {
  id: string
  path: SegmentPath
}

export interface SegmentReferences {
  listIds: SegmentReference[]
  segmentIds: SegmentReference[]
  topicIds: SegmentReference[]
  broadcastIds: SegmentReference[]
  templateIds: SegmentReference[]
}

const VALUE_REFERENCES: Partial<Record<SegmentFieldType, keyof SegmentReferences>> = {
  list: 'listIds',
  segment: 'segmentIds',
  topic: 'topicIds'
}

export function segmentReferences(rules: SegmentRules): SegmentReferences {
  const references: SegmentReferences = {
    listIds: [],
    segmentIds: [],
    topicIds: [],
    broadcastIds: [],
    templateIds: []
  }

  for (const { condition, path } of segmentConditionEntries(rules)) {
    if (condition.field === 'activity') {
      if (condition.scope === 'broadcast' && condition.broadcastId)
        references.broadcastIds.push({ id: condition.broadcastId, path: [...path, 'broadcastId'] })

      if (condition.scope === 'transactional' && condition.templateId)
        references.templateIds.push({ id: condition.templateId, path: [...path, 'templateId'] })

      continue
    }

    const key = VALUE_REFERENCES[segmentFieldDefinition(condition.field).type]

    if (key && condition.value)
      references[key].push({ id: String(condition.value), path: [...path, 'value'] })
  }

  return references
}

export function segmentReferenceIds(references: readonly SegmentReference[]): string[] {
  return [...new Set(references.map((reference) => reference.id))]
}

/** Ids of the lists referenced by `in list` / `not in list` conditions (unique, in order). */
export function segmentListIds(rules: SegmentRules): string[] {
  return segmentReferenceIds(segmentReferences(rules).listIds)
}

type NormalizedValue = string | number | null

type ValueResult = { ok: true; value: NormalizedValue } | { ok: false; message: string }

const DECIMAL_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const DAYS_MESSAGE = `Enter a whole number of days between 1 and ${MAX_SEGMENT_DAYS}`
const TIMES_MESSAGE = `Enter a whole number between 1 and ${MAX_SEGMENT_TIMES}`

/** A number, or a string holding a plain decimal literal (inputs bind numbers as text). */
function numericValue(message: string) {
  return z.union([z.number(), z.string().trim().regex(DECIMAL_PATTERN).transform(Number)], {
    error: message
  })
}

function wholeNumber(max: number, message: string) {
  return numericValue(message).pipe(z.int({ error: message }).min(1, message).max(max, message))
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
  days: wholeNumber(MAX_SEGMENT_DAYS, DAYS_MESSAGE),
  date: z.iso.date({ error: 'Pick a date' }),
  list: z.uuid({ error: 'Choose a list' }),
  segment: z.uuid({ error: 'Choose a segment' }),
  topic: z.uuid({ error: 'Choose a topic' }),
  activity: z.never({ error: 'Choose a property' }),
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
 * One contact property condition. Validates field/operator compatibility, the attribute key
 * and the value type, then normalizes it (trimmed text, integer days, numbers…).
 */
export const segmentFieldConditionSchema = z
  .object({
    field: z.literal(FIELD_KEYS, { error: 'Choose a property' }),
    operator: z.literal(OPERATOR_KEYS, { error: 'Choose an operator' }),
    key: z.string().max(200).nullish(),
    value: z.union([z.string().max(MAX_SEGMENT_TEXT * 2), z.number()]).nullish()
  })
  .strict()
  .transform((input, ctx): SegmentFieldCondition => {
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

    const condition: SegmentFieldCondition = {
      field: input.field,
      operator: input.operator,
      value: result.value
    }

    if (key !== undefined) condition.key = key

    return condition
  })

const activityInputSchema = z
  .object({
    field: z.literal('activity'),
    operator: z.enum(['has', 'has_not'], { error: 'Choose an operator' }),
    event: z.literal(ACTIVITY_EVENT_KEYS, { error: 'Choose an event' }),
    scope: z.literal(ACTIVITY_SCOPE_KEYS, { error: 'Choose which emails' }).default('any'),
    broadcastId: z.string().max(64).nullish(),
    templateId: z.string().max(64).nullish(),
    tag: z
      .object({ key: z.string().max(200), value: z.string().max(MAX_SEGMENT_TEXT * 2) })
      .strict()
      .nullish(),
    link: z
      .string()
      .max(MAX_SEGMENT_TEXT * 2)
      .nullish(),
    times: z.union([z.number(), z.string().max(20)]).nullish(),
    days: z.union([z.number(), z.string().max(20)]).nullish()
  })
  .strict()

const activityOutputSchema = z
  .object({
    field: z.literal('activity'),
    operator: z.enum(['has', 'has_not']),
    event: z.literal(ACTIVITY_EVENT_KEYS),
    scope: z.literal(ACTIVITY_SCOPE_KEYS),
    broadcastId: z.uuid({ error: 'Choose a broadcast' }).nullable().optional(),
    templateId: z.uuid({ error: 'Choose a template' }).nullable().optional(),
    tag: z
      .object({
        key: z
          .string()
          .trim()
          .min(1, { error: 'Enter a tag name', abort: true })
          .regex(SEGMENT_TAG_KEY_PATTERN, 'Use letters, digits, "_" or "-" (max 64)'),
        value: z
          .string()
          .trim()
          .min(1, 'Enter a tag value')
          .max(MAX_SEGMENT_TAG_VALUE, `Use at most ${MAX_SEGMENT_TAG_VALUE} characters`)
      })
      .strict()
      .optional(),
    link: z
      .string()
      .trim()
      .max(MAX_SEGMENT_TEXT, `Use at most ${MAX_SEGMENT_TEXT} characters`)
      .optional(),
    times: wholeNumber(MAX_SEGMENT_TIMES, TIMES_MESSAGE).optional(),
    days: wholeNumber(MAX_SEGMENT_DAYS, DAYS_MESSAGE).nullable()
  })
  .strict()

function applicableActivityFields(
  input: z.output<typeof activityInputSchema>
): z.input<typeof activityOutputSchema> {
  const condition: z.input<typeof activityOutputSchema> = {
    field: input.field,
    operator: input.operator,
    event: input.event,
    scope: input.scope,
    days: input.days ?? null
  }

  if (input.scope === 'broadcast') condition.broadcastId = input.broadcastId || null

  if (input.scope === 'transactional') {
    condition.templateId = input.templateId || null

    if (input.tag && (input.tag.key.trim() || input.tag.value.trim())) condition.tag = input.tag
  }

  const link = input.link?.trim()

  if (input.event === 'clicked' && link) condition.link = link

  if (input.operator === 'has') condition.times = input.times ?? 1

  return condition
}

export const segmentActivityConditionSchema = activityInputSchema
  .transform(applicableActivityFields)
  .pipe(activityOutputSchema) satisfies z.ZodType<SegmentActivityCondition>

export type SegmentFieldConditionState = z.input<typeof segmentFieldConditionSchema>

export type SegmentActivityConditionState = z.input<typeof segmentActivityConditionSchema>

export type SegmentConditionState = SegmentFieldConditionState | SegmentActivityConditionState

const OBJECT_INPUT = z.looseObject({})

function forward<I, O>(schema: z.ZodType<O, I>, input: I, ctx: z.RefinementCtx<I>): O {
  const result = schema.safeParse(input)

  if (result.success) return result.data

  for (const issue of result.error.issues)
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })

  return z.NEVER
}

export const segmentConditionSchema = z
  .custom<SegmentConditionState>((value) => OBJECT_INPUT.safeParse(value).success, {
    error: 'Add a condition'
  })
  .transform((input, ctx): SegmentCondition =>
    input.field === 'activity'
      ? forward(segmentActivityConditionSchema, input, ctx)
      : forward(segmentFieldConditionSchema, input, ctx)
  )

export const segmentGroupSchema = z
  .object({
    match: z.enum(['all', 'any', 'none']).default('all'),
    conditions: z
      .array(segmentConditionSchema)
      .min(1, 'Add a condition to this group')
      .max(
        MAX_SEGMENT_CONDITIONS,
        `A segment can have at most ${MAX_SEGMENT_CONDITIONS} conditions`
      )
  })
  .strict() satisfies z.ZodType<SegmentGroup>

export type SegmentGroupState = z.input<typeof segmentGroupSchema>

export type SegmentNodeState = SegmentConditionState | SegmentGroupState

export const segmentNodeSchema = z
  .custom<SegmentNodeState>((value) => OBJECT_INPUT.safeParse(value).success, {
    error: 'Add a condition'
  })
  .transform((input, ctx): SegmentNode =>
    'conditions' in input
      ? forward(segmentGroupSchema, input, ctx)
      : forward(segmentConditionSchema, input, ctx)
  )

export const segmentRulesSchema = z
  .object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z
      .array(segmentNodeSchema)
      .max(
        MAX_SEGMENT_CONDITIONS,
        `A segment can have at most ${MAX_SEGMENT_CONDITIONS} conditions`
      )
      .default([])
  })
  .strict()
  .superRefine((rules, ctx) => {
    if (segmentConditionEntries(rules).length > MAX_SEGMENT_CONDITIONS) {
      ctx.addIssue({
        code: 'custom',
        path: ['conditions'],
        message: `A segment can have at most ${MAX_SEGMENT_CONDITIONS} conditions`
      })
    }

    if (rules.conditions.filter(isSegmentGroup).length > MAX_SEGMENT_GROUPS) {
      ctx.addIssue({
        code: 'custom',
        path: ['conditions'],
        message: `A segment can have at most ${MAX_SEGMENT_GROUPS} groups`
      })
    }
  }) satisfies z.ZodType<SegmentRules>

export type SegmentRulesState = z.input<typeof segmentRulesSchema>

export const segmentInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish(),
  rules: segmentRulesSchema
})

export type SegmentInput = z.output<typeof segmentInputSchema>

/** Loose form state accepted by the schema (UI editors). */
export type SegmentInputState = z.input<typeof segmentInputSchema>

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
  segmentName?: (id: string) => string | undefined
  topicName?: (id: string) => string | undefined
  broadcastName?: (id: string) => string | undefined
  templateName?: (id: string) => string | undefined
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function quote(value: SegmentConditionValue) {
  return `“${String(value ?? '')}”`
}

function dayCount(value: SegmentConditionValue) {
  const n = Number(value)

  return `${n} ${n === 1 ? 'day' : 'days'}`
}

function lowerFirst(text: string) {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

function named(
  id: string,
  resolve: ((id: string) => string | undefined) | undefined,
  label: string,
  missing: string
) {
  const name = id ? resolve?.(id) : undefined

  return name ? `${label} ${quote(name)}` : missing
}

function activityTarget(
  condition: SegmentActivityCondition,
  context: SegmentDescribeContext
): string {
  switch (condition.scope) {
    case 'broadcast':
      return condition.broadcastId
        ? named(condition.broadcastId, context.broadcastName, 'broadcast', 'a deleted broadcast')
        : 'a broadcast'
    case 'transactional': {
      const template = condition.templateId
        ? named(
            condition.templateId,
            context.templateName,
            'transactional email',
            'a transactional email of a deleted template'
          )
        : 'a transactional email'

      return condition.tag
        ? `${template} tagged ${quote(`${condition.tag.key}=${condition.tag.value}`)}`
        : template
    }

    default:
      return 'any email'
  }
}

function describeActivityCondition(
  condition: SegmentActivityCondition,
  context: SegmentDescribeContext
): string {
  const { verb, preposition } = segmentActivityEventDefinition(condition.event)
  const target = activityTarget(condition, context)
  let object = preposition ? `${preposition} ${target}` : target

  if (condition.event === 'clicked') {
    const link = condition.link ? `a link containing ${quote(condition.link)}` : 'a link'
    object = `${link} ${object}`
  }

  const times = condition.operator === 'has' ? (condition.times ?? 1) : 1
  const repeat = times > 1 ? ` at least ${times} times` : ''
  const window = condition.days ? ` in the last ${dayCount(condition.days)}` : ' ever'

  return `${condition.operator === 'has' ? 'Has' : 'Has not'} ${verb} ${object}${repeat}${window}`
}

export function describeSegmentCondition(
  condition: SegmentCondition,
  context: SegmentDescribeContext = {}
): string {
  if (condition.field === 'activity') return describeActivityCondition(condition, context)

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

    case 'segment':
      return named(
        String(condition.value ?? ''),
        context.segmentName,
        operator === 'in_segment' ? 'In segment' : 'Not in segment',
        operator === 'in_segment' ? 'In a deleted segment' : 'Not in a deleted segment'
      )
    case 'topic':
      return named(
        String(condition.value ?? ''),
        context.topicName,
        operator === 'subscribed_topic' ? 'Subscribed to topic' : 'Not subscribed to topic',
        operator === 'subscribed_topic'
          ? 'Subscribed to a deleted topic'
          : 'Not subscribed to a deleted topic'
      )
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

function joinParts(parts: string[], joiner: string): string {
  if (parts.length === 1) return parts[0]!

  return `${parts.slice(0, -1).join(', ')} ${joiner} ${parts.at(-1)}`
}

function describeNode(node: SegmentNode, context: SegmentDescribeContext): string {
  if (!isSegmentGroup(node)) return describeSegmentCondition(node, context)

  const parts = node.conditions.map((c) => lowerFirst(describeSegmentCondition(c, context)))

  return `(${node.match} of: ${parts.join(', ')})`
}

/** One sentence describing the rules; empty rules match every contact. */
export function describeSegmentRules(
  rules: SegmentRules,
  context: SegmentDescribeContext = {}
): string {
  if (!rules.conditions.length) return 'All contacts'

  const parts = rules.conditions.map((node, i) => {
    const text = describeNode(node, context)

    return i === 0 ? text : lowerFirst(text)
  })

  return joinParts(parts, rules.match === 'all' ? 'and' : 'or')
}
