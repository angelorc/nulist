import { inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { emailEvents } from '../../db/schema'
import type { MetricPoint } from '../../../shared/types/domain'
import type { TenantScope } from '../core/TenantScope'
import type { AnalyticsPeriod } from './AnalyticsPeriod'

export interface ActivityTotals {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
}

export const EMPTY_TOTALS: ActivityTotals = Object.freeze({
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0
})

const ACTIVITY_TYPES = ['send', 'delivery', 'open', 'click', 'bounce', 'complaint'] as const

/**
 * Hard bounces only: transient (soft) bounces do not count against sender
 * reputation. Works with both the flattened (`data.bounceType`) and the raw
 * SES shape (`data.bounce.bounceType`); unknown shapes count as hard bounces.
 */
export const HARD_BOUNCE: SQL = sql`coalesce(${emailEvents.data}->>'bounceType', ${emailEvents.data}#>>'{bounce,bounceType}', 'Permanent') <> 'Transient'`

/** Opens and clicks by link scanners and prefetchers are recorded but are not engagement. */
const HUMAN: SQL = sql`coalesce(${emailEvents.data}->>'isBotEvent', 'false') <> 'true'`

/**
 * Funnel metrics from one organization's `email_events`, counting distinct
 * messages so repeated opens/clicks of the same email count once.
 */
export class EmailActivityQuery {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  private static distinctMessages(condition: SQL): SQL<number> {
    return sql<number>`count(distinct ${emailEvents.messageId}) filter (where ${condition})::int`
  }

  private static metricColumns() {
    const e = emailEvents

    return {
      sent: EmailActivityQuery.distinctMessages(sql`${e.type} = 'send'`),
      delivered: EmailActivityQuery.distinctMessages(sql`${e.type} = 'delivery'`),
      opened: EmailActivityQuery.distinctMessages(sql`${e.type} = 'open' and ${HUMAN}`),
      clicked: EmailActivityQuery.distinctMessages(sql`${e.type} = 'click' and ${HUMAN}`),
      bounced: EmailActivityQuery.distinctMessages(sql`${e.type} = 'bounce' and ${HARD_BOUNCE}`),
      complained: EmailActivityQuery.distinctMessages(sql`${e.type} = 'complaint'`)
    }
  }

  /**
   * The organization's funnel events in `[since, until)`. Shared by every query of
   * this class, and matches the (organization_id, type, occurred_at) index.
   */
  private window(since: Date, until: Date): SQL {
    const e = emailEvents

    return sql`${this.scope.eq(e.organizationId)} and ${inArray(e.type, [...ACTIVITY_TYPES])} and ${e.occurredAt} >= ${since} and ${e.occurredAt} < ${until}`
  }

  /** One point per UTC day from the previous period start to today; missing days are zero. */
  async daily(period: AnalyticsPeriod): Promise<MetricPoint[]> {
    const e = emailEvents
    const c = EmailActivityQuery.metricColumns()

    const result = await this.db.execute<{ [K in keyof MetricPoint]: MetricPoint[K] }>(sql`
      with activity as (
        select (${e.occurredAt} at time zone 'UTC')::date as day,
          ${c.sent} as sent, ${c.delivered} as delivered, ${c.opened} as opened,
          ${c.clicked} as clicked, ${c.bounced} as bounced, ${c.complained} as complained
        from ${e}
        where ${this.window(period.previousStart, period.end)}
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as date,
        coalesce(a.sent, 0)::int as sent,
        coalesce(a.delivered, 0)::int as delivered,
        coalesce(a.opened, 0)::int as opened,
        coalesce(a.clicked, 0)::int as clicked,
        coalesce(a.bounced, 0)::int as bounced,
        coalesce(a.complained, 0)::int as complained
      from generate_series(${period.previousStartDay}::date, ${period.endDay}::date, interval '1 day') as d(day)
      left join activity a on a.day = d.day::date
      order by d.day
    `)

    return result.rows
  }

  /** Distinct-message totals for the current and the previous period. */
  async totals(
    period: AnalyticsPeriod
  ): Promise<{ current: ActivityTotals; previous: ActivityTotals }> {
    const bucket = sql<
      'current' | 'previous'
    >`case when ${emailEvents.occurredAt} >= ${period.start} then 'current' else 'previous' end`

    const rows = await this.db
      .select({ bucket, ...EmailActivityQuery.metricColumns() })
      .from(emailEvents)
      .where(this.window(period.previousStart, period.end))
      .groupBy(sql`1`)

    const pick = (key: 'current' | 'previous'): ActivityTotals => {
      const row = rows.find((r) => r.bucket === key)

      if (!row) return { ...EMPTY_TOTALS }
      const { bucket: _bucket, ...totals } = row

      return totals
    }

    return { current: pick('current'), previous: pick('previous') }
  }

  /** Distinct-message totals for an arbitrary window (used for rolling health checks). */
  async between(since: Date, until: Date): Promise<ActivityTotals> {
    const [row] = await this.db
      .select(EmailActivityQuery.metricColumns())
      .from(emailEvents)
      .where(this.window(since, until))

    return row ?? { ...EMPTY_TOTALS }
  }
}
