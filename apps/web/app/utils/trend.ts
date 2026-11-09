/** Direction of a change between two periods. */
export type TrendDirection = 'up' | 'down' | 'flat'

/**
 * Change of a metric against the previous period, as a ratio (`0.124` = +12.4%).
 * The ratio is `null` when it cannot be expressed (no previous value, or growth from zero).
 *
 * ```ts
 * const trend = Trend.between(opens, previousOpens)
 * trend.isGood(true) // true when it went up
 * ```
 */
export class Trend {
  private constructor(readonly ratio: number | null) {}

  /** The change from `previous` to `current`; growth from zero has no ratio. */
  static between(current: number, previous: number | null | undefined): Trend {
    if (previous === null || previous === undefined) return new Trend(null)

    if (previous === 0) return new Trend(current === 0 ? 0 : null)

    return new Trend((current - previous) / Math.abs(previous))
  }

  /** Whether a ratio is known. */
  get comparable(): boolean {
    return this.ratio !== null
  }

  /** `null` when the ratio is unknown. */
  get direction(): TrendDirection | null {
    if (this.ratio === null) return null

    if (this.ratio > 0) return 'up'

    return this.ratio < 0 ? 'down' : 'flat'
  }

  /**
   * Whether the change goes the metric's good way (bounce rate up is bad: `higherIsBetter`
   * false). `null` when flat or unknown.
   */
  isGood(higherIsBetter: boolean): boolean | null {
    const direction = this.direction

    if (direction === null || direction === 'flat') return null

    return (direction === 'up') === higherIsBetter
  }
}
