import { z } from 'zod'
import { ATTRIBUTE_KEY_PATTERN } from './contacts'

/** Built-in targets a CSV column can map to (plus `attribute:<key>`). */
export const IMPORT_FIELD_TARGETS = ['email', 'first_name', 'last_name', 'ignore'] as const

export type ImportFieldTarget = (typeof IMPORT_FIELD_TARGETS)[number]

export type ImportTarget = ImportFieldTarget | `attribute:${string}`

export const ATTRIBUTE_TARGET_PREFIX = 'attribute:'

export const MAX_IMPORT_CSV_BYTES = 50 * 1024 * 1024

/**
 * Papa Parse options shared by the browser preview and the server import so
 * both see exactly the same columns.
 */
export const CSV_PARSE_OPTIONS = {
  header: true,
  skipEmptyLines: 'greedy',
  transformHeader: (header: string) => header.trim()
} as const

const FIELD_TARGETS: ReadonlySet<string> = new Set(IMPORT_FIELD_TARGETS)

/** A built-in field or `attribute:<key>` with a valid attribute key. */
export function isImportTarget(value: string): value is ImportTarget {
  if (FIELD_TARGETS.has(value)) return true

  return (
    value.startsWith(ATTRIBUTE_TARGET_PREFIX) &&
    ATTRIBUTE_KEY_PATTERN.test(value.slice(ATTRIBUTE_TARGET_PREFIX.length))
  )
}

export const importTargetSchema = z.string().refine((value) => isImportTarget(value), {
  message: 'Attribute keys use letters, numbers and underscores, starting with a letter'
})

export const importMappingSchema = z
  .record(z.string().max(200), importTargetSchema)
  .superRefine((mapping, ctx) => {
    const targets = Object.values(mapping).filter((target) => target !== 'ignore')
    const emails = targets.filter((target) => target === 'email').length

    if (emails === 0) ctx.addIssue({ code: 'custom', message: 'Map one column to Email' })

    if (emails > 1)
      ctx.addIssue({ code: 'custom', message: 'Only one column can be mapped to Email' })
    const seen = new Set<string>()

    for (const target of targets) {
      if (seen.has(target)) {
        const label = target.startsWith(ATTRIBUTE_TARGET_PREFIX)
          ? `attribute "${target.slice(ATTRIBUTE_TARGET_PREFIX.length)}"`
          : target.replace('_', ' ')

        ctx.addIssue({ code: 'custom', message: `Two columns are mapped to ${label}` })

        return
      }

      seen.add(target)
    }
  })

export const importModeSchema = z.enum(['skip', 'merge', 'overwrite'])
export const importSubscriptionStatusSchema = z.enum(['confirmed', 'send_opt_in'])

export const importCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  csv: z
    .string()
    .min(1, 'The file is empty')
    .max(MAX_IMPORT_CSV_BYTES, 'The file is larger than 50 MB'),
  mapping: importMappingSchema,
  mode: importModeSchema.default('merge'),
  listId: z.uuid().nullish(),
  /** Only used when the target list is double opt-in. */
  subscriptionStatus: importSubscriptionStatusSchema.default('confirmed')
})

export type ImportCreateInput = z.input<typeof importCreateSchema>

export type ImportCreateData = z.output<typeof importCreateSchema>

export const importListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
})
