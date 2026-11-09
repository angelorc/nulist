import { z } from 'zod'
import type { AudienceDefinition } from '../types/domain'

const ids = z.array(z.uuid()).max(100).default([])

export const broadcastAudienceSchema = z.object({
  listIds: ids,
  segmentIds: ids,
  excludeListIds: ids
})

export const broadcastUtmSchema = z.object({
  enabled: z.boolean().default(false),
  source: z.string().trim().max(100).optional(),
  medium: z.string().trim().max(100).optional(),
  campaign: z.string().trim().max(100).optional()
})

/** Empty string clears an optional email field. */
const optionalEmail = z
  .union([
    z.literal(''),
    z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))
  ])
  .nullish()
  .transform((value) => value || null)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null)

export const broadcastUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    subject: z.string().trim().max(300),
    preheader: optionalText(300),
    fromName: optionalText(120),
    fromEmail: optionalEmail,
    replyTo: optionalEmail,
    templateId: z.uuid().nullable(),
    topicId: z.uuid().nullable(),
    audience: broadcastAudienceSchema,
    utm: broadcastUtmSchema
  })
  .partial()

export type BroadcastUpdateInput = z.infer<typeof broadcastUpdateSchema>

export const broadcastCreateSchema = broadcastUpdateSchema.extend({
  name: z.string().trim().min(1).max(120).default('Untitled broadcast')
})

export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>

export const BROADCAST_TABS = ['all', 'draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const

export const broadcastListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(BROADCAST_TABS).optional()
})

export type BroadcastListQuery = z.infer<typeof broadcastListQuerySchema>

export const broadcastScheduleSchema = z.object({
  /** Omit or null to send now. */
  scheduledAt: z.coerce.date().nullish()
})

export type BroadcastScheduleInput = z.infer<typeof broadcastScheduleSchema>

export const broadcastTestSchema = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().pipe(z.email('Enter valid email addresses')))
    .min(1, 'Add at least one recipient')
    .max(5, 'Send to at most 5 addresses at a time')
})

export type BroadcastTestInput = z.infer<typeof broadcastTestSchema>

export const broadcastEstimateSchema = z.object({
  audience: broadcastAudienceSchema,
  topicId: z.uuid().nullish()
})

export type BroadcastEstimateInput = z.infer<typeof broadcastEstimateSchema>

export const BROADCAST_RECIPIENT_FILTERS = [
  'pending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'cancelled'
] as const

export const broadcastRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(BROADCAST_RECIPIENT_FILTERS).optional()
})

export type BroadcastRecipientsQuery = z.infer<typeof broadcastRecipientsQuerySchema>

export const EMPTY_AUDIENCE: AudienceDefinition = Object.freeze({
  listIds: [],
  segmentIds: [],
  excludeListIds: []
})

/** "Black Friday 2026!" → "black-friday-2026" (default UTM campaign). */
export function campaignSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'broadcast'
  )
}

/** Whether the audience selects anyone at all (lists or segments). */
export function hasAudienceSources(audience: AudienceDefinition): boolean {
  return audience.listIds.length > 0 || audience.segmentIds.length > 0
}
