import type {
  DeliverabilityHealth,
  DeliverabilityThresholds,
  HealthStatus
} from '../../../shared/types/analytics'
import { DAY_MS, ratio } from './AnalyticsPeriod'
import type { EmailActivityQuery } from './EmailActivityQuery'

/**
 * Warning levels sit below the points where providers act: Amazon SES puts
 * accounts under review at a 5% bounce rate and a 0.1% complaint rate, and
 * Gmail enforces a 0.3% spam rate for bulk senders.
 */
export const DELIVERABILITY_THRESHOLDS: Readonly<DeliverabilityThresholds> = Object.freeze({
  bounceWarn: 0.02,
  bounceCritical: 0.05,
  complaintWarn: 0.0008,
  complaintCritical: 0.001
})

const SEVERITY: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 }

/** Rolling bounce/complaint rates compared with provider thresholds. */
export class DeliverabilityMonitor {
  constructor(
    private readonly activity: EmailActivityQuery,
    private readonly thresholds: DeliverabilityThresholds = { ...DELIVERABILITY_THRESHOLDS },
    private readonly windowDays = 7
  ) {}

  static classify(value: number, warn: number, critical: number): HealthStatus {
    if (value >= critical) return 'critical'

    if (value >= warn) return 'warning'

    return 'healthy'
  }

  static worst(...statuses: HealthStatus[]): HealthStatus {
    return statuses.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'healthy')
  }

  async health(now: Date = new Date()): Promise<DeliverabilityHealth> {
    const totals = await this.activity.between(
      new Date(now.getTime() - this.windowDays * DAY_MS),
      now
    )

    const bounceRate = ratio(totals.bounced, totals.sent)
    const complaintRate = ratio(totals.complained, totals.sent)
    const t = this.thresholds
    const bounceStatus = DeliverabilityMonitor.classify(bounceRate, t.bounceWarn, t.bounceCritical)

    const complaintStatus = DeliverabilityMonitor.classify(
      complaintRate,
      t.complaintWarn,
      t.complaintCritical
    )

    return {
      bounceRate,
      complaintRate,
      thresholds: { ...t },
      status: DeliverabilityMonitor.worst(bounceStatus, complaintStatus),
      bounceStatus,
      complaintStatus,
      sent: totals.sent,
      bounced: totals.bounced,
      complained: totals.complained,
      windowDays: this.windowDays
    }
  }
}
