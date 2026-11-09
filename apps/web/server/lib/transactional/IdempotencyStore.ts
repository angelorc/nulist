import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { messages } from '../../db/schema'
import { IDEMPOTENCY_WINDOW_HOURS } from '../../../shared/schemas/transactional'
import { ConflictError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'

export type MessageRow = typeof messages.$inferSelect

/**
 * Binds an Idempotency-Key to one message per API key. API keys belong to one
 * organization, so the index is per organization by construction.
 */
const IDEMPOTENCY_INDEX = 'messages_idempotency_uq'

const UNIQUE_VIOLATION = '23505'

/** The fields of a Postgres error (node-postgres), directly or wrapped by drizzle in `cause`. */
const postgresErrorSchema = z.object({
  code: z.string().optional(),
  constraint: z.string().optional(),
  cause: z.object({ code: z.string().optional(), constraint: z.string().optional() }).optional()
})

/** True for the unique index that binds an Idempotency-Key to one message per API key. */
export function isIdempotencyViolation(cause: unknown): boolean {
  const parsed = postgresErrorSchema.safeParse(cause)

  if (!parsed.success) return false

  const code = parsed.data.code ?? parsed.data.cause?.code
  const constraint = parsed.data.constraint ?? parsed.data.cause?.constraint

  return code === UNIQUE_VIOLATION && (!constraint || constraint === IDEMPOTENCY_INDEX)
}

/**
 * Idempotency-Key bookkeeping on the organization's `messages` (unique per API
 * key). A key is bound to the request hash of its first use for 24 hours.
 */
export class IdempotencyStore {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly windowHours = IDEMPOTENCY_WINDOW_HOURS
  ) {}

  /**
   * The message created earlier with this key and the same payload, or null when
   * the key is new or expired (expired keys are released). Throws 409 when the key
   * was used with a different payload.
   */
  async find(
    apiKeyId: string | null,
    key: string,
    requestHash: string
  ): Promise<MessageRow | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          apiKeyId ? eq(messages.apiKeyId, apiKeyId) : isNull(messages.apiKeyId),
          eq(messages.idempotencyKey, key)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1)

    if (!row) return null

    if (row.createdAt.getTime() < Date.now() - this.windowHours * 3_600_000) {
      await this.db
        .update(messages)
        .set({ idempotencyKey: null })
        .where(and(this.scope.eq(messages.organizationId), eq(messages.id, row.id)))

      return null
    }

    if (row.requestHash !== requestHash) {
      throw new ConflictError(
        'This Idempotency-Key was already used with a different request body. Use a new key for a different email.',
        'invalid_idempotent_request',
        { idempotencyKey: key }
      )
    }

    return row
  }
}
