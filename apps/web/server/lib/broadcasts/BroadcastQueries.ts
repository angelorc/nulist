import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { broadcasts, contacts, messages } from '../../db/schema'
import type {
  BroadcastListQuery,
  BroadcastRecipientsQuery
} from '../../../shared/schemas/broadcasts'
import type {
  BroadcastListStats,
  BroadcastProgress,
  BroadcastRecipientFilter,
  BroadcastTab,
  BroadcastTabCounts
} from '../../../shared/types/broadcasts'
import type { BroadcastStatus, MessageStatus, Paginated } from '../../../shared/types/domain'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

type BroadcastRow = typeof broadcasts.$inferSelect

export type BroadcastListRow = Omit<
  BroadcastRow,
  'organizationId' | 'audience' | 'utm' | 'runId' | 'htmlSnapshot' | 'createdById'
> & { stats: BroadcastListStats }

export interface BroadcastRecipientRow {
  messageId: string
  contactId: string | null
  email: string
  firstName: string | null
  lastName: string | null
  status: MessageStatus
  error: string | null
  sentAt: Date | null
  deliveredAt: Date | null
  openedAt: Date | null
  clickedAt: Date | null
  openCount: number
  clickCount: number
}

/** Index tabs that filter by status (every tab but `all`). */
const STATUS_TABS = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled'
] as const satisfies readonly Exclude<BroadcastTab, 'all'>[]

type StatusTab = (typeof STATUS_TABS)[number]

const TAB_STATUSES: Record<StatusTab, BroadcastStatus[]> = {
  draft: ['draft'],
  scheduled: ['scheduled'],
  sending: ['sending', 'paused'],
  sent: ['sent'],
  cancelled: ['cancelled', 'failed']
}

const LIST_COLUMNS = {
  id: broadcasts.id,
  name: broadcasts.name,
  subject: broadcasts.subject,
  preheader: broadcasts.preheader,
  fromName: broadcasts.fromName,
  fromEmail: broadcasts.fromEmail,
  replyTo: broadcasts.replyTo,
  templateId: broadcasts.templateId,
  topicId: broadcasts.topicId,
  status: broadcasts.status,
  scheduledAt: broadcasts.scheduledAt,
  startedAt: broadcasts.startedAt,
  completedAt: broadcasts.completedAt,
  recipientCount: broadcasts.recipientCount,
  createdAt: broadcasts.createdAt,
  updatedAt: broadcasts.updatedAt
}

const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`
const delivered = sql`(${messages.deliveredAt} is not null or ${messages.status} in ('delivered', 'complained'))`

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

const EMPTY_STATS: BroadcastListStats = {
  recipients: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  openRate: 0,
  clickRate: 0
}

/**
 * Read models of the broadcasts feature: index table, tab counts, progress and
 * recipients. Every query is limited to the organization of the scope.
 */
export class BroadcastQueries {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async list(query: BroadcastListQuery): Promise<Paginated<BroadcastListRow>> {
    const page = Page.from(query)
    const q = query.q?.trim()

    const where = and(
      this.scope.eq(broadcasts.organizationId),
      query.status && query.status !== 'all'
        ? inArray(broadcasts.status, TAB_STATUSES[query.status])
        : undefined,
      q
        ? or(
            ilike(broadcasts.name, containsPattern(q)),
            ilike(broadcasts.subject, containsPattern(q))
          )
        : undefined
    )

    const [rows, [total]] = await Promise.all([
      this.db
        .select(LIST_COLUMNS)
        .from(broadcasts)
        .where(where)
        .orderBy(
          desc(
            sql`coalesce(${broadcasts.startedAt}, ${broadcasts.scheduledAt}, ${broadcasts.createdAt})`
          ),
          desc(broadcasts.id)
        )
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(broadcasts).where(where)
    ])

    const stats = await this.stats(rows.map((r) => r.id))

    return page.wrap(
      rows.map((row) => Object.assign(row, { stats: stats.get(row.id) ?? EMPTY_STATS })),
      total?.value ?? 0
    )
  }

  async tabCounts(): Promise<BroadcastTabCounts> {
    const rows = await this.db
      .select({ status: broadcasts.status, value: count() })
      .from(broadcasts)
      .where(this.scope.eq(broadcasts.organizationId))
      .groupBy(broadcasts.status)

    const counts: BroadcastTabCounts = {
      all: 0,
      draft: 0,
      scheduled: 0,
      sending: 0,
      sent: 0,
      cancelled: 0
    }

    for (const row of rows) {
      counts.all += row.value

      for (const tab of STATUS_TABS) {
        if (TAB_STATUSES[tab].includes(row.status)) counts[tab] += row.value
      }
    }

    return counts
  }

  /** Aggregate engagement per broadcast (one grouped query for the whole page). */
  async stats(broadcastIds: string[]): Promise<Map<string, BroadcastListStats>> {
    if (!broadcastIds.length) return new Map()

    const rows = await this.db
      .select({
        broadcastId: messages.broadcastId,
        recipients: sql<number>`count(*)::int`,
        sent: countWhere(sql`${messages.sentAt} is not null`),
        delivered: countWhere(delivered),
        opened: countWhere(sql`${messages.openedAt} is not null`),
        clicked: countWhere(sql`${messages.clickedAt} is not null`)
      })
      .from(messages)
      .where(
        and(this.scope.eq(messages.organizationId), inArray(messages.broadcastId, broadcastIds))
      )
      .groupBy(messages.broadcastId)

    return new Map(
      rows.flatMap((row): [string, BroadcastListStats][] =>
        row.broadcastId
          ? [
              [
                row.broadcastId,
                {
                  recipients: row.recipients,
                  sent: row.sent,
                  delivered: row.delivered,
                  opened: row.opened,
                  clicked: row.clicked,
                  openRate: ratio(row.opened, row.delivered),
                  clickRate: ratio(row.clicked, row.delivered)
                }
              ]
            ]
          : []
      )
    )
  }

  async progress(broadcastId: string): Promise<BroadcastProgress> {
    const m = messages

    const [row] = await this.db
      .select({
        recipients: sql<number>`count(*)::int`,
        pending: countWhere(sql`${m.status} in ('queued', 'scheduled', 'sending')`),
        sent: countWhere(sql`${m.sentAt} is not null`),
        failed: countWhere(sql`${m.status} in ('failed', 'rejected')`),
        suppressed: countWhere(sql`${m.status} = 'suppressed'`),
        cancelled: countWhere(sql`${m.status} = 'cancelled'`)
      })
      .from(m)
      .where(and(this.scope.eq(m.organizationId), eq(m.broadcastId, broadcastId)))

    return row ?? { recipients: 0, pending: 0, sent: 0, failed: 0, suppressed: 0, cancelled: 0 }
  }

  async recipients(
    broadcastId: string,
    query: BroadcastRecipientsQuery
  ): Promise<Paginated<BroadcastRecipientRow>> {
    const page = Page.from(query)
    const q = query.q?.trim().toLowerCase()

    const where = and(
      this.scope.eq(messages.organizationId),
      eq(messages.broadcastId, broadcastId),
      query.status ? this.recipientFilter(query.status) : undefined,
      q ? ilike(messages.toEmail, containsPattern(q)) : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db
        .select({
          messageId: messages.id,
          contactId: messages.contactId,
          email: messages.toEmail,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          status: messages.status,
          error: messages.error,
          sentAt: messages.sentAt,
          deliveredAt: messages.deliveredAt,
          openedAt: messages.openedAt,
          clickedAt: messages.clickedAt,
          openCount: messages.openCount,
          clickCount: messages.clickCount
        })
        .from(messages)
        .leftJoin(
          contacts,
          and(eq(contacts.id, messages.contactId), this.scope.eq(contacts.organizationId))
        )
        .where(where)
        .orderBy(asc(messages.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(messages).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  private recipientFilter(filter: BroadcastRecipientFilter): SQL | undefined {
    switch (filter) {
      case 'pending':
        return inArray(messages.status, ['queued', 'scheduled', 'sending'])
      case 'sent':
        return isNotNull(messages.sentAt)
      case 'delivered':
        return delivered
      case 'opened':
        return isNotNull(messages.openedAt)
      case 'clicked':
        return isNotNull(messages.clickedAt)
      case 'failed':
        return inArray(messages.status, ['failed', 'rejected'])
      default:
        return eq(messages.status, filter)
    }
  }
}
