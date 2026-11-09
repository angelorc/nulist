import type { AnalyticsRange } from '../../../shared/types/analytics'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000

const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * UTC day-aligned reporting window. The current period covers the last `days`
 * calendar days (today included, up to now); the previous period is the
 * same number of days immediately before it.
 */
export class AnalyticsPeriod {
  readonly days: number
  readonly start: Date
  readonly end: Date
  readonly previousStart: Date

  constructor(
    readonly range: AnalyticsRange,
    now: Date = new Date()
  ) {
    this.days = RANGE_DAYS[range]
    const today = AnalyticsPeriod.startOfUtcDay(now)
    this.end = now
    this.start = new Date(today.getTime() - (this.days - 1) * DAY_MS)
    this.previousStart = new Date(this.start.getTime() - this.days * DAY_MS)
  }

  static startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  }

  static startOfUtcHour(date: Date): Date {
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)
  }

  /** `YYYY-MM-DD` in UTC. */
  static dayKey(date: Date): string {
    return date.toISOString().slice(0, 10)
  }

  get startDay(): string {
    return AnalyticsPeriod.dayKey(this.start)
  }

  get previousStartDay(): string {
    return AnalyticsPeriod.dayKey(this.previousStart)
  }

  get endDay(): string {
    return AnalyticsPeriod.dayKey(this.end)
  }

  /** Whether a `YYYY-MM-DD` key falls in the current period. */
  isCurrent(dayKey: string): boolean {
    return dayKey >= this.startDay
  }

  toJSON() {
    return {
      start: this.start.toISOString(),
      end: this.end.toISOString(),
      previousStart: this.previousStart.toISOString(),
      days: this.days
    }
  }
}

/** Safe division for rates (0 when there is no denominator). */
export function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}
