import { eq } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { inboundEvents } from '../../db/schema'
import type { JsonObject } from '../../../shared/types/domain'

export type InboundStatus = 'processed' | 'ignored' | 'failed'

export type InboundEventRow = typeof inboundEvents.$inferSelect

/** Where an inbound event came from (one SNS delivery, or the simulator). */
export interface InboundSource {
  /** SNS MessageId — the idempotency key. */
  snsMessageId: string
  /** SNS message type (`Notification`, `SubscriptionConfirmation`…) or `Simulation`. */
  type: string
  topicArn: string | null
  payload: JsonObject
}

/** How an inbound event was settled. */
export interface InboundOutcome {
  status: InboundStatus
  /** Why it was ignored or failed. */
  error?: string | null
  /** Organization the event belongs to (null: instance-level, or not correlated). */
  organizationId?: string | null
}

const MAX_ERROR = 1_000

/**
 * Instance-wide writer of the inbound provider event log (SES via SNS). One
 * SNS endpoint serves every organization, so the unique SNS MessageId is an
 * instance-wide idempotency key: a message is handled once, except when the
 * previous attempt failed, which may be retried. Rows are attributed to an
 * organization once the event is correlated (`complete`); subscription
 * confirmations and unparseable deliveries stay instance-level (no
 * organization). Organizations read their rows through InboundEventReader.
 */
export class InboundEventLog {
  constructor(private readonly db: Database) {}

  /**
   * Claims the message inside `tx`. Returns the row id when this caller owns
   * processing, or null when the message was already processed or ignored.
   * Concurrent deliveries of the same message block on the unique index until
   * the first transaction ends. The organization is unknown at claim time, so
   * a retried failed row is detached until `complete` attributes it again.
   */
  async claim(
    tx: Executor,
    source: InboundSource,
    eventType: string | null
  ): Promise<string | null> {
    const values = {
      ...InboundEventLog.columns(source, eventType),
      organizationId: null,
      status: 'processed' as const,
      error: null
    }

    const [row] = await tx
      .insert(inboundEvents)
      .values(values)
      .onConflictDoUpdate({
        target: inboundEvents.snsMessageId,
        set: values,
        setWhere: eq(inboundEvents.status, 'failed')
      })
      .returning({ id: inboundEvents.id })

    return row?.id ?? null
  }

  /** Settles a claimed row and attributes it to the organization the event was applied in. */
  async complete(tx: Executor, id: string, outcome: InboundOutcome): Promise<void> {
    await tx
      .update(inboundEvents)
      .set({
        status: outcome.status,
        error: InboundEventLog.truncate(outcome.error ?? null),
        organizationId: outcome.organizationId ?? null
      })
      .where(eq(inboundEvents.id, id))
  }

  /**
   * One-shot record outside of any processing transaction. Returns false for
   * duplicates. `organizationId` is set when the event is known to belong to
   * an organization (a failed event carrying a valid `organization_id` tag).
   */
  async record(
    source: InboundSource,
    eventType: string | null,
    outcome: InboundOutcome
  ): Promise<boolean> {
    const values = {
      ...InboundEventLog.columns(source, eventType),
      organizationId: outcome.organizationId ?? null,
      status: outcome.status,
      error: InboundEventLog.truncate(outcome.error ?? null)
    }

    const [row] = await this.db
      .insert(inboundEvents)
      .values(values)
      .onConflictDoUpdate({
        target: inboundEvents.snsMessageId,
        set: values,
        setWhere: eq(inboundEvents.status, 'failed')
      })
      .returning({ id: inboundEvents.id })

    return Boolean(row)
  }

  /** True when the message was already handled successfully (processed or ignored). */
  async isHandled(snsMessageId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: inboundEvents.status })
      .from(inboundEvents)
      .where(eq(inboundEvents.snsMessageId, snsMessageId))

    return Boolean(row && row.status !== 'failed')
  }

  private static columns(source: InboundSource, eventType: string | null) {
    return {
      snsMessageId: source.snsMessageId,
      type: source.type,
      eventType,
      topicArn: source.topicArn,
      payload: source.payload
    }
  }

  private static truncate(error: string | null): string | null {
    return error === null ? null : error.slice(0, MAX_ERROR)
  }
}
