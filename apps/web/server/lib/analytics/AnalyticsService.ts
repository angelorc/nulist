import type { Database } from '../../db/client'
import type {
  AudienceGrowthPoint,
  BroadcastReport,
  DashboardOverview
} from '../../../shared/types/analytics'
import type { Kpi, MetricPoint } from '../../../shared/types/domain'
import { AnalyticsPeriod, ratio } from './AnalyticsPeriod'
import type { AnalyticsWindow } from './AnalyticsPeriod'
import { AudienceGrowthQuery } from './AudienceGrowthQuery'
import { BroadcastAnalytics } from './BroadcastAnalytics'
import { DeliverabilityMonitor } from './DeliverabilityMonitor'
import { EmailActivityQuery } from './EmailActivityQuery'
import type { ActivityTotals } from './EmailActivityQuery'
import { OnboardingProbe } from './OnboardingProbe'
import type { TenantScope } from '../core/TenantScope'

type RateKey = 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained'

/** The aggregated part of the overview (everything but the onboarding checklist). */
type OverviewMetrics = Omit<DashboardOverview, 'onboarding'>

/** The overview's aggregates scan whole periods of events: reused for a minute. */
const OVERVIEW_TTL_MS = 60_000

/**
 * Read-only reporting facade for one organization's dashboard and broadcast
 * reports. Aggregation happens in Postgres; this class composes the query
 * objects (each scoped to the same organization) and turns raw counts into KPIs.
 */
export class AnalyticsService {
  private readonly activity: EmailActivityQuery
  private readonly audience: AudienceGrowthQuery
  private readonly deliverability: DeliverabilityMonitor
  private readonly broadcasts: BroadcastAnalytics
  private readonly onboarding: OnboardingProbe
  /** Per period key: the latest (or in-flight) aggregation, shared by concurrent dashboard loads. */
  private readonly metrics = new Map<string, { at: number; value: Promise<OverviewMetrics> }>()

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database
  ) {
    this.activity = new EmailActivityQuery(scope, db)
    this.audience = new AudienceGrowthQuery(scope, db)
    this.deliverability = new DeliverabilityMonitor(this.activity)
    this.broadcasts = new BroadcastAnalytics(scope, db)
    this.onboarding = new OnboardingProbe(scope, db)
  }

  /**
   * The dashboard: aggregates are cached per period for OVERVIEW_TTL_MS (and shared
   * while being computed), the onboarding checklist is always fresh.
   */
  async overview(window: AnalyticsWindow): Promise<DashboardOverview> {
    const [metrics, onboarding] = await Promise.all([
      this.cachedMetrics(AnalyticsPeriod.of(window)),
      this.onboarding.status()
    ])

    return { ...metrics, onboarding }
  }

  private async cachedMetrics(period: AnalyticsPeriod): Promise<OverviewMetrics> {
    const { key } = period
    const cached = this.metrics.get(key)

    if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) return cached.value

    const value = this.computeMetrics(period)
    this.sweepMetrics()
    this.metrics.set(key, { at: Date.now(), value })

    try {
      return await value
    } catch (error) {
      // Never cache a failure.
      if (this.metrics.get(key)?.value === value) this.metrics.delete(key)
      throw error
    }
  }

  private sweepMetrics(): void {
    const now = Date.now()

    for (const [key, entry] of this.metrics) {
      if (now - entry.at >= OVERVIEW_TTL_MS) this.metrics.delete(key)
    }
  }

  private async computeMetrics(period: AnalyticsPeriod): Promise<OverviewMetrics> {
    const [daily, totals, growthDaily, unsubscribes, health, topBroadcasts] = await Promise.all([
      this.activity.daily(period),
      this.activity.totals(period),
      this.audience.daily(period),
      this.audience.unsubscribeTotals(period),
      this.deliverability.health(),
      this.broadcasts.top(period.start, period.end)
    ])

    const series = daily.filter((p) => period.isCurrent(p.date))
    const growth = growthDaily.filter((p) => period.isCurrent(p.date))

    return {
      range: period.range,
      period: period.toJSON(),
      kpis: AnalyticsService.kpis(series, totals.current, totals.previous, growth, unsubscribes),
      series,
      growth,
      health,
      topBroadcasts
    }
  }

  async broadcastReport(broadcastId: string): Promise<BroadcastReport> {
    return this.broadcasts.report(broadcastId)
  }

  private static kpis(
    series: MetricPoint[],
    current: ActivityTotals,
    previous: ActivityTotals,
    growth: AudienceGrowthPoint[],
    unsubscribes: { current: number; previous: number }
  ): Kpi[] {
    const rate = (
      key: string,
      label: string,
      numerator: RateKey,
      denominator: 'sent' | 'delivered',
      higherIsBetter: boolean
    ): Kpi => ({
      key,
      label,
      value: ratio(current[numerator], current[denominator]),
      previous: ratio(previous[numerator], previous[denominator]),
      format: 'percent',
      higherIsBetter,
      spark: series.map((p) => ratio(p[numerator], p[denominator]))
    })

    return [
      {
        key: 'sent',
        label: 'Emails sent',
        value: current.sent,
        previous: previous.sent,
        format: 'number',
        higherIsBetter: true,
        spark: series.map((p) => p.sent)
      },
      rate('delivery_rate', 'Delivery rate', 'delivered', 'sent', true),
      rate('open_rate', 'Open rate', 'opened', 'delivered', true),
      rate('click_rate', 'Click rate', 'clicked', 'delivered', true),
      rate('bounce_rate', 'Bounce rate', 'bounced', 'sent', false),
      rate('complaint_rate', 'Complaint rate', 'complained', 'sent', false),
      {
        key: 'unsubscribes',
        label: 'Unsubscribes',
        value: unsubscribes.current,
        previous: unsubscribes.previous,
        format: 'number',
        higherIsBetter: false,
        spark: growth.map((p) => p.unsubscribed)
      }
    ]
  }
}
