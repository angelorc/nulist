import { afterAll, describe, expect, it } from 'vitest'
import { emailEvents } from '../server/db/schema'
import { AnalyticsPeriod, DAY_MS } from '../server/lib/analytics/AnalyticsPeriod'
import { TestPlatform } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

const today = AnalyticsPeriod.startOfUtcDay(new Date()).getTime()

function daysAgo(days: number, hour = 12): Date {
  return new Date(today - days * DAY_MS + hour * 3_600_000)
}

describe('dashboard custom range', () => {
  it('reports whole UTC days of a from/to range against the same number of days before it', async () => {
    const org = await platform.organization('Custom range')

    const sent = await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => org.deliverEmail(`${name}@example.test`))
    )

    const at = [daysAgo(9, 0), daysAgo(7, 23), daysAgo(11), daysAgo(6, 0)]

    await platform.db.insert(emailEvents).values(
      sent.map(
        (email, index) =>
          ({
            organizationId: org.id,
            messageId: email.messageId,
            type: 'send',
            occurredAt: at[index]
          }) satisfies typeof emailEvents.$inferInsert
      )
    )

    const overview = await org.services.analytics.overview({
      range: '30d',
      from: AnalyticsPeriod.dayKey(daysAgo(9)),
      to: AnalyticsPeriod.dayKey(daysAgo(7))
    })

    const kpi = overview.kpis.find((k) => k.key === 'sent')

    expect(overview.range).toBe('custom')
    expect(overview.series.map((p) => p.date)).toEqual(
      [9, 8, 7].map((days) => AnalyticsPeriod.dayKey(daysAgo(days)))
    )
    expect(overview.period.days).toBe(3)
    expect(overview.period.previousStart).toBe(daysAgo(12, 0).toISOString())
    expect(overview.period.end).toBe(daysAgo(6, 0).toISOString())
    expect(kpi?.value).toBe(2)
    expect(kpi?.previous).toBe(1)
  })
})
