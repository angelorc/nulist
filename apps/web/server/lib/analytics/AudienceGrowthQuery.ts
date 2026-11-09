import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, emailEvents, listSubscriptions, lists } from '../../db/schema'
import type { AudienceGrowthPoint } from '../../../shared/types/analytics'
import type { TenantScope } from '../core/TenantScope'
import type { AnalyticsPeriod } from './AnalyticsPeriod'

/**
 * One organization's audience movement per day. Unsubscribes merge list-level
 * opt-outs (`list_subscriptions.unsubscribed_at`) with email-driven ones
 * (`email_events` of type `unsubscribe`), deduplicated per contact.
 * `list_subscriptions` has no organization column: it is scoped through its list.
 */
export class AudienceGrowthQuery {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  /** Subscriptions of the organization's lists (`list_subscriptions` joined to its scoped parent). */
  private scopedSubscriptions(): SQL {
    const s = listSubscriptions

    return sql`${s} inner join ${lists} on ${lists.id} = ${s.listId} and ${this.scope.eq(lists.organizationId)}`
  }

  private unsubscribes(since: Date, until: Date): SQL {
    const s = listSubscriptions
    const e = emailEvents

    return sql`
      select ${s.contactId} as contact_id, ${s.unsubscribedAt} as at
      from ${this.scopedSubscriptions()}
      where ${s.unsubscribedAt} >= ${since} and ${s.unsubscribedAt} < ${until}
      union all
      select ${e.contactId} as contact_id, ${e.occurredAt} as at
      from ${e}
      where ${this.scope.eq(e.organizationId)} and ${e.type} = 'unsubscribe'
        and ${e.contactId} is not null
        and ${e.occurredAt} >= ${since} and ${e.occurredAt} < ${until}
    `
  }

  /** One point per UTC day from the previous period start to today; missing days are zero. */
  async daily(period: AnalyticsPeriod): Promise<AudienceGrowthPoint[]> {
    const since = period.previousStart
    const until = period.end
    const s = listSubscriptions

    const result = await this.db.execute<{
      date: string
      subscribed: number
      unsubscribed: number
      new_contacts: number
    }>(sql`
      with unsubs as (${this.unsubscribes(since, until)}),
      u as (
        select (at at time zone 'UTC')::date as day, count(distinct contact_id)::int as n from unsubs group by 1
      ),
      subs as (
        select (${s.confirmedAt} at time zone 'UTC')::date as day, count(distinct ${s.contactId})::int as n
        from ${this.scopedSubscriptions()}
        where ${s.confirmedAt} >= ${since} and ${s.confirmedAt} < ${until}
        group by 1
      ),
      created as (
        select (${contacts.createdAt} at time zone 'UTC')::date as day, count(*)::int as n
        from ${contacts}
        where ${this.scope.eq(contacts.organizationId)}
          and ${contacts.createdAt} >= ${since} and ${contacts.createdAt} < ${until}
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as date,
        coalesce(subs.n, 0)::int as subscribed,
        coalesce(u.n, 0)::int as unsubscribed,
        coalesce(created.n, 0)::int as new_contacts
      from generate_series(${period.previousStartDay}::date, ${period.endDay}::date, interval '1 day') as d(day)
      left join subs on subs.day = d.day::date
      left join u on u.day = d.day::date
      left join created on created.day = d.day::date
      order by d.day
    `)

    return result.rows.map((row) => ({
      date: row.date,
      subscribed: row.subscribed,
      unsubscribed: row.unsubscribed,
      net: row.subscribed - row.unsubscribed,
      newContacts: row.new_contacts
    }))
  }

  /** Distinct contacts that unsubscribed in the current and previous periods. */
  async unsubscribeTotals(period: AnalyticsPeriod): Promise<{ current: number; previous: number }> {
    const result = await this.db.execute<{ current: number; previous: number }>(sql`
      with unsubs as (${this.unsubscribes(period.previousStart, period.end)})
      select
        count(distinct contact_id) filter (where at >= ${period.start})::int as current,
        count(distinct contact_id) filter (where at < ${period.start})::int as previous
      from unsubs
    `)

    return result.rows[0] ?? { current: 0, previous: 0 }
  }
}
