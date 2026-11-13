import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { LogPeriod, LogVolumePoint } from '../../../shared/types/logs'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const PERIOD_MS: Record<LogPeriod, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS
}

export type LogBucket = 'hour' | 'day'

export class LogWindow {
  readonly bucket: LogBucket

  private constructor(
    readonly period: LogPeriod,
    private readonly now: number
  ) {
    this.bucket = period === '24h' ? 'hour' : 'day'
  }

  static since(period: LogPeriod | undefined, now = Date.now()): Date | undefined {
    return period ? new Date(now - PERIOD_MS[period]) : undefined
  }

  static of(period: LogPeriod | undefined, now = Date.now()): LogWindow {
    return new LogWindow(period ?? '30d', now)
  }

  get from(): Date {
    return new Date(this.bucketStart(this.now - PERIOD_MS[this.period] + this.step))
  }

  bucketKey(column: AnyColumn): SQL<string> {
    const pattern = this.bucket === 'hour' ? 'YYYY-MM-DD"T"HH24:00:00"Z"' : 'YYYY-MM-DD'

    return sql<string>`to_char(${column} at time zone 'UTC', ${sql.raw(`'${pattern}'`)})`
  }

  fill(rows: LogVolumePoint[]): LogVolumePoint[] {
    const byKey = new Map(rows.map((row) => [row.at, row]))
    const points: LogVolumePoint[] = []

    for (let at = this.from.getTime(); at <= this.now; at += this.step) {
      const key = this.key(at)

      points.push(byKey.get(key) ?? { at: key, ok: 0, issues: 0, other: 0 })
    }

    return points
  }

  private get step(): number {
    return this.bucket === 'hour' ? HOUR_MS : DAY_MS
  }

  private bucketStart(time: number): number {
    return time - (time % this.step)
  }

  private key(time: number): string {
    const iso = new Date(time).toISOString()

    return this.bucket === 'hour' ? `${iso.slice(0, 13)}:00:00Z` : iso.slice(0, 10)
  }
}
