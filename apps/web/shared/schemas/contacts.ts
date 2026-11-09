import { z } from 'zod'
import type { PermissionRequest } from '../auth/permissions'
import type { AttributeValue } from '../types/contacts'
import type { JsonValue } from '../types/domain'

export const CONTACT_STATUSES = [
  'active',
  'unsubscribed',
  'bounced',
  'complained',
  'blocklisted'
] as const

export const contactStatusSchema = z.enum(CONTACT_STATUSES)

/** Normalized (trimmed, lowercase) email address. */
export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'))

/** Attribute keys are usable as Liquid paths: `{{ contact.attributes.plan }}`. */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z_]\w{0,63}$/i

export const attributeKeySchema = z
  .string()
  .trim()
  .regex(
    ATTRIBUTE_KEY_PATTERN,
    'Use letters, numbers and underscores (max 64), starting with a letter'
  )

export const attributeValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null()
])

export const contactAttributesSchema = z
  .record(attributeKeySchema, attributeValueSchema)
  .refine((value) => Object.keys(value).length <= 100, 'A contact can have at most 100 attributes')

const nameSchema = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((v) => v || null)

export const contactCreateSchema = z.object({
  email: contactEmailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  attributes: contactAttributesSchema.optional(),
  /** Lists to subscribe the new contact to. */
  listIds: z.array(z.uuid()).max(50).optional(),
  /** Subscribe double opt-in lists as confirmed (the admin vouches for consent). */
  skipOptIn: z.boolean().optional()
})

export type ContactCreateInput = z.input<typeof contactCreateSchema>

export type ContactCreateData = z.output<typeof contactCreateSchema>

export const contactUpdateSchema = z.object({
  email: contactEmailSchema.optional(),
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  attributes: contactAttributesSchema.optional(),
  /** `merge` (default) keeps keys not sent and removes keys set to null; `replace` swaps the whole object. */
  attributesMode: z.enum(['merge', 'replace']).default('merge'),
  status: contactStatusSchema.optional()
})

export type ContactUpdateInput = z.input<typeof contactUpdateSchema>

export type ContactUpdateData = z.output<typeof contactUpdateSchema>

/** Editable profile fields in the dashboard form. */
export const contactProfileSchema = z.object({
  email: contactEmailSchema,
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional()
})

export type ContactProfileInput = z.input<typeof contactProfileSchema>

export const CONTACT_SORTS = [
  'email',
  '-email',
  'name',
  '-name',
  'status',
  '-status',
  'createdAt',
  '-createdAt',
  'lastOpenedAt',
  '-lastOpenedAt'
] as const

export type ContactSort = (typeof CONTACT_SORTS)[number]

/** Ids as a JSON array or as one comma separated query string value. */
const idsSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean)), z.array(z.string())])
  .pipe(z.array(z.uuid()).max(1000))

export const contactFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: contactStatusSchema.optional(),
  listId: z.uuid().optional()
})

export const contactListQuerySchema = contactFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(CONTACT_SORTS).default('-createdAt')
})

export type ContactListQuery = z.output<typeof contactListQuerySchema>

export const contactExportQuerySchema = contactFilterSchema.extend({
  /** Comma separated ids: export only these contacts (bulk selection). */
  ids: idsSchema.optional()
})

export type ContactExportQuery = z.output<typeof contactExportQuerySchema>

const bulkIds = z.array(z.uuid()).min(1, 'Select at least one contact').max(1000)

export const contactBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({ action: z.literal('unsubscribe'), ids: bulkIds }),
  z.object({
    action: z.literal('add_to_list'),
    ids: bulkIds,
    listId: z.uuid(),
    skipOptIn: z.boolean().default(false)
  }),
  z.object({ action: z.literal('remove_from_list'), ids: bulkIds, listId: z.uuid() }),
  z.object({ action: z.literal('set_status'), ids: bulkIds, status: contactStatusSchema })
])

export type ContactBulkInput = z.output<typeof contactBulkSchema>

export type ContactBulkAction = ContactBulkInput['action']

/**
 * What each bulk action requires in the active organization. The bulk route
 * enforces it after parsing the body; the contacts page gates its buttons with it.
 */
export const CONTACT_BULK_PERMISSIONS = {
  delete: { contact: ['delete'] },
  unsubscribe: { contact: ['update'] },
  add_to_list: { contact: ['update'] },
  remove_from_list: { contact: ['update'] },
  set_status: { contact: ['update'] }
} as const satisfies Record<ContactBulkAction, PermissionRequest>

export const contactSubscribeSchema = z.object({
  listId: z.uuid(),
  skipOptIn: z.boolean().default(false)
})

/** `listId: null` unsubscribes from everything (global unsubscribe). */
export const contactUnsubscribeSchema = z.object({
  listId: z.uuid().nullable()
})

export const contactActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
})

/**
 * Turns text typed in a form or read from a CSV into a typed attribute value:
 * booleans and plain numbers are converted, everything else stays text.
 * Numbers with leading zeros (zip codes) or more than 15 digits (phone, ids) stay text.
 */
export function coerceAttributeValue(raw: string): AttributeValue {
  const value = raw.trim()

  if (value === '') return null
  const lower = value.toLowerCase()

  if (lower === 'true') return true

  if (lower === 'false') return false

  if (/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(value)) return Number(value)

  return value
}

const textValueSchema = z.string()
const numberValueSchema = z.number()
const booleanValueSchema = z.boolean()
const scalarValueSchema = z.union([textValueSchema, numberValueSchema, booleanValueSchema])

/** How a stored attribute value is shown in the dashboard. */
export type AttributeValueKind = 'empty' | 'text' | 'number' | 'boolean' | 'list' | 'object'

export function attributeValueKind(value: JsonValue | undefined): AttributeValueKind {
  if (value === null || value === undefined) return 'empty'

  if (Array.isArray(value)) return 'list'

  if (textValueSchema.safeParse(value).success) return 'text'

  if (numberValueSchema.safeParse(value).success) return 'number'

  return booleanValueSchema.safeParse(value).success ? 'boolean' : 'object'
}

/** Text form of a stored attribute value (CSV cells, form inputs): lists and objects as JSON. */
export function formatAttributeValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  const scalar = scalarValueSchema.safeParse(value)

  return scalar.success ? String(scalar.data) : JSON.stringify(value)
}

/** Turns a free-form header such as "Company Name" into an attribute key ("company_name"). */
export function toAttributeKey(label: string): string {
  const key = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)

  if (!key) return 'attribute'

  return /^[a-z_]/.test(key) ? key : `attr_${key}`.slice(0, 64)
}
