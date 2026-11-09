import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { inboundEvents } from '../../db/schema'
import type { InboundStatus } from './InboundEventLog'
import { NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export interface InboundEventQuery {
  page: number
  pageSize: number
  q?: string
  eventType?: string
  status?: InboundStatus
}

/** First recipient of the SES mail object. */
const recipient = sql<string | null>`${inboundEvents.payload}->'mail'->'destination'->>0`

/** mlist message the event refers to (our `message_id` SES tag). */
const taggedMessageId = sql<
  string | null
>`${inboundEvents.payload}->'mail'->'tags'->'message_id'->>0`

/**
 * The organization's view of the inbound event log: only events correlated
 * with one of its messages (or carrying its `organization_id` tag). Instance
 * level rows (SNS subscription confirmations, unparseable deliveries) belong
 * to no organization and are never listed.
 */
export class InboundEventReader {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async list(query: InboundEventQuery) {
    const page = Page.from(query)

    const where = and(
      this.scope.eq(inboundEvents.organizationId),
      query.eventType ? eq(inboundEvents.eventType, query.eventType) : undefined,
      query.status ? eq(inboundEvents.status, query.status) : undefined,
      query.q
        ? or(
            ilike(inboundEvents.snsMessageId, containsPattern(query.q)),
            sql`${inboundEvents.payload}->'mail'->>'messageId' ilike ${containsPattern(query.q)}`,
            sql`${recipient} ilike ${containsPattern(query.q)}`
          )
        : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db
        .select({
          id: inboundEvents.id,
          snsMessageId: inboundEvents.snsMessageId,
          type: inboundEvents.type,
          eventType: inboundEvents.eventType,
          topicArn: inboundEvents.topicArn,
          status: inboundEvents.status,
          error: inboundEvents.error,
          recipient,
          createdAt: inboundEvents.createdAt
        })
        .from(inboundEvents)
        .where(where)
        .orderBy(desc(inboundEvents.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(inboundEvents).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  /** One event of this organization; ids of other organizations are not found. */
  async get(id: string) {
    const [row] = await this.db
      .select({
        id: inboundEvents.id,
        snsMessageId: inboundEvents.snsMessageId,
        type: inboundEvents.type,
        eventType: inboundEvents.eventType,
        topicArn: inboundEvents.topicArn,
        payload: inboundEvents.payload,
        status: inboundEvents.status,
        error: inboundEvents.error,
        recipient,
        messageId: taggedMessageId,
        createdAt: inboundEvents.createdAt
      })
      .from(inboundEvents)
      .where(and(this.scope.eq(inboundEvents.organizationId), eq(inboundEvents.id, id)))

    if (!row) throw new NotFoundError('Inbound event', id)

    return row
  }
}
