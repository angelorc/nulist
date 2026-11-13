import type { AnalyticsRange } from '../../../shared/types/analytics'
import { MAX_RANGE_DAYS } from '../../../shared/schemas/logs'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000

const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** What the dashboard asks for: a preset, overridden by `from`/`to` (`YYYY-MM-DD`) when both are set. */
export interface AnalyticsWindow {
  range: AnalyticsRange
  from?: string
  to?: string
}

/**
 * UTC day-aligned reporting window. A preset covers the last `days` calendar
 * days (today included, up to now); a custom range covers whole UTC days from
 * `from` to `to` (both inclusive, capped at now). The previous period is the
 * same number of days immediately before it.
 */
export class AnalyticsPeriod {
  readonly previousStart: Date

  private constructor(
    readonly range: AnalyticsRange | 'custom',
    readonly start: Date,
    readonly end: Date,
    private readonly lastDay: Date,
    readonly days: number
  ) {
    this.previousStart = new Date(start.getTime() - days * DAY_MS)
  }

  static preset(range: AnalyticsRange, now: Date = new Date()): AnalyticsPeriod {
    const days = RANGE_DAYS[range]
    const today = AnalyticsPeriod.startOfUtcDay(now)

    return new AnalyticsPeriod(
      range,
      new Date(today.getTime() - (days - 1) * DAY_MS),
      now,
      today,
      days
    )
  }

  /** Whole UTC days `from`..`to`: swapped when reversed, capped at today, at most MAX_RANGE_DAYS long. */
  static custom(from: string, to: string, now: Date = new Date()): AnalyticsPeriod {
    const today = AnalyticsPeriod.startOfUtcDay(now).getTime()
    const a = AnalyticsPeriod.parseDay(from)
    const b = AnalyticsPeriod.parseDay(to)
    const last = Math.min(Math.max(a, b), today)
    const first = Math.max(Math.min(a, b, last), last - (MAX_RANGE_DAYS - 1) * DAY_MS)
    const end = Math.min(last + DAY_MS, now.getTime())

    return new AnalyticsPeriod(
      'custom',
      new Date(first),
      new Date(end),
      new Date(last),
      Math.round((last - first) / DAY_MS) + 1
    )
  }

  static of(window: AnalyticsWindow, now: Date = new Date()): AnalyticsPeriod {
    return window.from && window.to
      ? AnalyticsPeriod.custom(window.from, window.to, now)
      : AnalyticsPeriod.preset(window.range, now)
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

  private static parseDay(day: string): number {
    return Date.parse(`${day}T00:00:00Z`)
  }

  /** Identifies the window for caching: the preset, or the custom days. */
  get key(): string {
    return this.range === 'custom' ? `custom:${this.startDay}:${this.endDay}` : this.range
  }

  get startDay(): string {
    return AnalyticsPeriod.dayKey(this.start)
  }

  get previousStartDay(): string {
    return AnalyticsPeriod.dayKey(this.previousStart)
  }

  /** The last UTC day of the current period. */
  get endDay(): string {
    return AnalyticsPeriod.dayKey(this.lastDay)
  }

  /** Whether a `YYYY-MM-DD` key falls in the current period. */
  isCurrent(dayKey: string): boolean {
    return dayKey >= this.startDay && dayKey <= this.endDay
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
