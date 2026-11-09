import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { broadcasts, emailEvents, messages } from '../../db/schema'
import type {
  BroadcastReport,
  BroadcastTimelinePoint,
  LinkClickStat,
  TopBroadcast
} from '../../../shared/types/analytics'
import { NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import { AnalyticsPeriod, DAY_MS, HOUR_MS, ratio } from './AnalyticsPeriod'

const HOURLY_WINDOW_HOURS = 48
const MAX_DAILY_POINTS = 60

const count = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`

/** Opens and clicks by link scanners and prefetchers are kept in the log but not reported. */
const HUMAN = sql`coalesce(${emailEvents.data}->>'isBotEvent', 'false') <> 'true'`

/**
 * Per-broadcast reporting for one organization: totals, rates, engagement
 * timeline, links and domains. A broadcast of another organization is "not found".
 */
export class BroadcastAnalytics {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async report(broadcastId: string, now: Date = new Date()): Promise<BroadcastReport> {
    const [broadcast] = await this.db
      .select({
        id: broadcasts.id,
        name: broadcasts.name,
        status: broadcasts.status,
        startedAt: broadcasts.startedAt,
        completedAt: broadcasts.completedAt
      })
      .from(broadcasts)
      .where(and(this.scope.eq(broadcasts.organizationId), eq(broadcasts.id, broadcastId)))

    if (!broadcast) throw new NotFoundError('Broadcast', broadcastId)

    const [totals, unsubscribed, timeline, links, domains] = await Promise.all([
      this.totals(broadcastId),
      this.unsubscribed(broadcastId),
      broadcast.startedAt
        ? this.timeline(broadcastId, broadcast.startedAt, now)
        : Promise.resolve([]),
      this.links(broadcastId),
      this.domains(broadcastId)
    ])

    return {
      broadcastId,
      name: broadcast.name,
      status: broadcast.status,
      startedAt: broadcast.startedAt?.toISOString() ?? null,
      completedAt: broadcast.completedAt?.toISOString() ?? null,
      totals: { ...totals, unsubscribed },
      rates: {
        delivery: ratio(totals.delivered, totals.sent),
        open: ratio(totals.uniqueOpens, totals.delivered),
        click: ratio(totals.uniqueClicks, totals.delivered),
        clickToOpen: ratio(totals.uniqueClicks, totals.uniqueOpens),
        bounce: ratio(totals.bounced, totals.sent),
        complaint: ratio(totals.complained, totals.sent),
        unsubscribe: ratio(unsubscribed, totals.delivered)
      },
      timeline,
      links,
      domains
    }
  }

  /** Best performing broadcasts started since `since`, ranked by click rate. */
  async top(since: Date, limit = 5): Promise<TopBroadcast[]> {
    const m = messages
    const delivered = sql<number>`count(${m.id}) filter (where ${m.deliveredAt} is not null)::int`
    const opened = sql<number>`count(${m.id}) filter (where ${m.openedAt} is not null)::int`
    const clicked = sql<number>`count(${m.id}) filter (where ${m.clickedAt} is not null)::int`

    const sentAt = sql<
      string | Date | null
    >`coalesce(${broadcasts.startedAt}, ${broadcasts.completedAt})`

    const rows = await this.db
      .select({
        id: broadcasts.id,
        name: broadcasts.name,
        sentAt,
        recipients: sql<number>`count(${m.id})::int`,
        delivered,
        opened,
        clicked
      })
      .from(broadcasts)
      .innerJoin(m, and(eq(m.broadcastId, broadcasts.id), this.scope.eq(m.organizationId)))
      .where(
        and(
          this.scope.eq(broadcasts.organizationId),
          inArray(broadcasts.status, ['sent', 'sending']),
          gte(sentAt, since)
        )
      )
      .groupBy(broadcasts.id)
      .orderBy(sql`(${clicked})::float / nullif(${delivered}, 0) desc nulls last`, desc(sentAt))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
      recipients: row.recipients,
      openRate: ratio(row.opened, row.delivered),
      clickRate: ratio(row.clicked, row.delivered)
    }))
  }

  /** Messages of one broadcast; `report()` has already checked that the broadcast is ours. */
  private ofBroadcast(broadcastId: string): SQL | undefined {
    return and(this.scope.eq(messages.organizationId), eq(messages.broadcastId, broadcastId))
  }

  /**
   * Events of one broadcast, through the indexed `email_events.broadcast_id`
   * (set on every event of a broadcast message) instead of a join to `messages`.
   */
  private eventsOf(broadcastId: string): SQL | undefined {
    return and(this.scope.eq(emailEvents.organizationId), eq(emailEvents.broadcastId, broadcastId))
  }

  private async totals(broadcastId: string) {
    const m = messages

    const [row] = await this.db
      .select({
        recipients: sql<number>`count(*)::int`,
        queued: count(sql`${m.status} in ('queued', 'scheduled', 'sending')`),
        sent: count(sql`${m.sentAt} is not null`),
        delivered: count(
          sql`${m.deliveredAt} is not null or ${m.status} in ('delivered', 'complained')`
        ),
        bounced: count(sql`${m.status} = 'bounced'`),
        complained: count(sql`${m.status} = 'complained'`),
        failed: count(sql`${m.status} in ('failed', 'rejected')`),
        suppressed: count(sql`${m.status} = 'suppressed'`),
        uniqueOpens: count(sql`${m.openedAt} is not null`),
        uniqueClicks: count(sql`${m.clickedAt} is not null`)
      })
      .from(m)
      .where(this.ofBroadcast(broadcastId))

    return (
      row ?? {
        recipients: 0,
        queued: 0,
        sent: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        failed: 0,
        suppressed: 0,
        uniqueOpens: 0,
        uniqueClicks: 0
      }
    )
  }

  private async unsubscribed(broadcastId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(distinct ${emailEvents.messageId})::int` })
      .from(emailEvents)
      .where(and(this.eventsOf(broadcastId), eq(emailEvents.type, 'unsubscribe')))

    return row?.value ?? 0
  }

  /** Opens and clicks per hour for the first 48h after sending started, then per day. */
  private async timeline(
    broadcastId: string,
    startedAt: Date,
    now: Date
  ): Promise<BroadcastTimelinePoint[]> {
    const e = emailEvents
    const firstHour = AnalyticsPeriod.startOfUtcHour(startedAt)
    const hourlyEnd = new Date(firstHour.getTime() + HOURLY_WINDOW_HOURS * HOUR_MS)

    const bucket = sql<string>`case
      when ${e.occurredAt} < ${hourlyEnd} then to_char(date_trunc('hour', ${e.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24":00:00Z"')
      else to_char(date_trunc('day', ${e.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD"T00:00:00Z"')
    end`

    const rows = await this.db
      .select({
        bucket,
        opens: sql<number>`count(*) filter (where ${e.type} = 'open')::int`,
        clicks: sql<number>`count(*) filter (where ${e.type} = 'click')::int`
      })
      .from(e)
      .where(and(this.eventsOf(broadcastId), inArray(e.type, ['open', 'click']), HUMAN))
      .groupBy(sql`1`)

    const byBucket = new Map(rows.map((r) => [r.bucket, r]))

    const points: BroadcastTimelinePoint[] = []

    const point = (date: string, granularity: BroadcastTimelinePoint['granularity']) => {
      const row = byBucket.get(date)
      points.push({ date, opens: row?.opens ?? 0, clicks: row?.clicks ?? 0, granularity })
    }

    const hourlyStop = Math.min(hourlyEnd.getTime(), now.getTime())

    for (let t = firstHour.getTime(); t <= hourlyStop && t < hourlyEnd.getTime(); t += HOUR_MS) {
      point(`${new Date(t).toISOString().slice(0, 13)}:00:00Z`, 'hour')
    }

    if (now > hourlyEnd) {
      const lastActivity = rows.reduce((max, r) => (r.bucket > max ? r.bucket : max), '')
      const firstDay = AnalyticsPeriod.startOfUtcDay(hourlyEnd).getTime()

      const lastDay = Math.min(
        AnalyticsPeriod.startOfUtcDay(now).getTime(),
        Math.max(
          firstDay,
          lastActivity ? AnalyticsPeriod.startOfUtcDay(new Date(lastActivity)).getTime() : firstDay
        ),
        firstDay + (MAX_DAILY_POINTS - 1) * DAY_MS
      )

      for (let t = firstDay; t <= lastDay; t += DAY_MS) {
        point(`${AnalyticsPeriod.dayKey(new Date(t))}T00:00:00Z`, 'day')
      }
    }

    return points
  }

  private async links(broadcastId: string): Promise<LinkClickStat[]> {
    const e = emailEvents
    const url = sql<string>`coalesce(${e.data}->>'link', ${e.data}#>>'{click,link}')`
    const uniqueClicks = sql<number>`count(distinct ${e.messageId})::int`

    return this.db
      .select({ url, clicks: sql<number>`count(*)::int`, uniqueClicks })
      .from(e)
      .where(and(this.eventsOf(broadcastId), eq(e.type, 'click'), HUMAN, isNotNull(url)))
      .groupBy(sql`1`)
      .orderBy(desc(uniqueClicks), desc(sql`count(*)`))
      .limit(20)
  }

  private async domains(broadcastId: string) {
    const m = messages
    const domain = sql<string>`lower(split_part(${m.toEmail}, '@', 2))`
    const recipients = sql<number>`count(*)::int`

    return this.db
      .select({
        domain,
        recipients,
        delivered: count(sql`${m.deliveredAt} is not null`),
        opens: count(sql`${m.openedAt} is not null`)
      })
      .from(m)
      .where(this.ofBroadcast(broadcastId))
      .groupBy(sql`1`)
      .orderBy(desc(recipients))
      .limit(10)
  }
}
