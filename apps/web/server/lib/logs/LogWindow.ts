import { and, gte, lt, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { MAX_RANGE_DAYS } from '../../../shared/schemas/logs'
import type { DateRangeQuery } from '../../../shared/schemas/logs'
import type { LogPeriod, LogVolumePoint, LogWindowRange } from '../../../shared/types/logs'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const HOURLY_MAX_MS = 48 * HOUR_MS

const PERIOD_MS: Record<LogPeriod, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS
}

const CHART_DEFAULT: LogPeriod = '30d'

export type LogBucket = 'hour' | 'day'

/** Time bounds of a list filter: `from` inclusive, `to` exclusive; a missing end is open. */
export interface LogBounds {
  from?: Date
  to?: Date
}

function startOfDay(time: number): number {
  return time - (time % DAY_MS)
}

/**
 * The time filter of a log query and the chart window it is drawn in. A preset
 * `period` is a rolling window ending now; a custom `from`/`to` covers whole UTC
 * days (both inclusive, swapped when reversed, the end capped at now, at most
 * MAX_RANGE_DAYS long). Charts are hourly up to 48 hours, daily otherwise, and
 * cover the last 30 days when the query has no time filter.
 */
export class LogWindow {
  readonly bucket: LogBucket
  private readonly start: number

  private constructor(
    start: number,
    private readonly end: number,
    private readonly closed: boolean,
    readonly period: LogPeriod | null
  ) {
    this.bucket = end - start <= HOURLY_MAX_MS ? 'hour' : 'day'
    this.start = Math.ceil(start / this.step) * this.step
  }

  static bounds(query: DateRangeQuery, now = Date.now()): LogBounds {
    if (!query.from && !query.to) {
      return query.period ? { from: new Date(now - PERIOD_MS[query.period]) } : {}
    }

    const days = [query.from, query.to].map((day) => (day ? Date.parse(day) : undefined))
    let [first, last] = days

    if (first !== undefined && last !== undefined && first > last) [first, last] = [last, first]

    const today = startOfDay(now)
    const lastDay = Math.min(last ?? today, today)
    const earliest = lastDay - (MAX_RANGE_DAYS - 1) * DAY_MS
    const bounds: LogBounds = {}

    if (first !== undefined) bounds.from = new Date(Math.min(Math.max(first, earliest), lastDay))

    if (last !== undefined) bounds.to = new Date(Math.min(last + DAY_MS, now))

    return bounds
  }

  static of(query: DateRangeQuery, now = Date.now()): LogWindow {
    if (query.from || query.to) {
      const { from, to } = LogWindow.bounds(query, now)
      const end = to?.getTime() ?? now
      const start = from?.getTime() ?? startOfDay(end - 1) - (PERIOD_MS[CHART_DEFAULT] - DAY_MS)

      return new LogWindow(start, end, to !== undefined, null)
    }

    const period = query.period ?? CHART_DEFAULT

    return new LogWindow(now - PERIOD_MS[period], now, false, period)
  }

  get range(): LogWindowRange {
    return {
      from: new Date(this.start).toISOString(),
      to: new Date(this.end).toISOString(),
      period: this.period
    }
  }

  /** Rows of `column` inside the chart window. */
  within(column: AnyColumn): SQL | undefined {
    return and(
      gte(column, new Date(this.start)),
      this.closed ? lt(column, new Date(this.end)) : undefined
    )
  }

  bucketKey(column: AnyColumn): SQL<string> {
    const pattern = this.bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00:00"Z"' : 'YYYY-MM-DD'

    return sql<string>`to_char(${column} at time zone 'UTC', ${sql.raw(`'${pattern}'`)})`
  }

  fill(rows: LogVolumePoint[]): LogVolumePoint[] {
    const byKey = new Map(rows.map((row) => [row.at, row]))
    const points: LogVolumePoint[] = []

    for (let at = this.start; at < this.end; at += this.step) {
      const key = this.key(at)

      points.push(byKey.get(key) ?? { at: key, ok: 0, issues: 0, other: 0 })
    }

    return points
  }

  private get step(): number {
    return this.bucket === 'hour' ? HOUR_MS : DAY_MS
  }

  private key(time: number): string {
    const iso = new Date(time).toISOString()

    return this.bucket === 'hour' ? `${iso.slice(0, 13)}:00:00Z` : iso.slice(0, 10)
  }
}
