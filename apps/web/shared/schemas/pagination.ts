import { z } from 'zod'

/** `?page&pageSize&q` shared by every paginated list endpoint. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional()
})

export type PaginationQuery = z.infer<typeof paginationSchema>
