import { z } from 'zod'

export const listInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish(),
  optIn: z.enum(['single', 'double']).default('single'),
  isPublic: z.boolean().default(true)
})

export type ListInput = z.infer<typeof listInputSchema>

/** PATCH body: every field optional and without defaults (zod v4 applies defaults inside `.partial()`). */
export const listUpdateSchema = z.object({
  name: listInputSchema.shape.name.optional(),
  description: listInputSchema.shape.description,
  optIn: z.enum(['single', 'double']).optional(),
  isPublic: z.boolean().optional()
})

export type ListUpdate = z.infer<typeof listUpdateSchema>

export const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(['unconfirmed', 'confirmed', 'unsubscribed']).optional()
})
