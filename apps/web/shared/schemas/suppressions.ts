import { z } from 'zod'
import type { SuppressionReason } from '../types/domain'

export const SUPPRESSION_REASONS = [
  'hard_bounce',
  'soft_bounce',
  'complaint',
  'unsubscribe',
  'manual'
] as const satisfies readonly SuppressionReason[]

export const SUPPRESSION_REASON_LABELS: Record<
  SuppressionReason,
  { label: string; description: string; blocksTransactional: boolean }
> = {
  hard_bounce: {
    label: 'Hard bounce',
    description: 'The address does not exist or permanently rejects mail',
    blocksTransactional: true
  },
  soft_bounce: {
    label: 'Soft bounce',
    description: 'Repeated temporary failures reached the threshold',
    blocksTransactional: false
  },
  complaint: {
    label: 'Complaint',
    description: 'The recipient marked an email as spam',
    blocksTransactional: true
  },
  unsubscribe: {
    label: 'Unsubscribe',
    description: 'The contact unsubscribed from everything',
    blocksTransactional: false
  },
  manual: { label: 'Manual', description: 'Added by a team member', blocksTransactional: true }
}

const email = z.string().trim().toLowerCase().max(320).pipe(z.email('Enter a valid email address'))

export const suppressionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  reason: z.enum(SUPPRESSION_REASONS).optional()
})

export const suppressionInputSchema = z.object({
  email,
  /** Only manual suppressions can be added by hand; the others come from events. */
  reason: z.literal('manual').default('manual')
})

export type SuppressionInput = z.infer<typeof suppressionInputSchema>

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const suppressionEmailParamsSchema = z.object({
  email: z.string().transform(safeDecode).pipe(email)
})
