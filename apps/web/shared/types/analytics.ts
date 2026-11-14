import type { BroadcastStatus, Kpi, MetricPoint } from './domain'

export type AnalyticsRange = '7d' | '30d' | '90d'

export interface DeliverabilityThresholds {
  bounceWarn: number
  bounceCritical: number
  complaintWarn: number
  complaintCritical: number
}

export type HealthStatus = 'healthy' | 'warning' | 'critical'

export interface DeliverabilityHealth {
  /** Rolling 7 day rates (0..1). */
  bounceRate: number
  complaintRate: number
  thresholds: DeliverabilityThresholds
  status: HealthStatus
  /** Status of each metric on its own. */
  bounceStatus: HealthStatus
  complaintStatus: HealthStatus
  /** Volume behind the rates (emails sent in the window). */
  sent: number
  bounced: number
  complained: number
  windowDays: number
}

export interface AudienceGrowthPoint {
  date: string
  subscribed: number
  unsubscribed: number
  net: number
  /** Contacts created that day (any source). */
  newContacts: number
}

export interface TopBroadcast {
  id: string
  name: string
  sentAt: string | null
  recipients: number
  openRate: number
  clickRate: number
}

/** First-run checklist steps, each checked from real data. */
export type OnboardingStep = 'sending' | 'domain' | 'list' | 'contacts' | 'template' | 'broadcast'

export interface OnboardingStatus {
  steps: Record<OnboardingStep, boolean>
  /** True once at least one email has been sent. */
  hasSent: boolean
}

export interface DashboardOverview {
  /** The preset, or `custom` for a `from`/`to` range. */
  range: AnalyticsRange | 'custom'
  /** Current period bounds (ISO), previous period ends where this one starts. */
  period: { start: string; end: string; previousStart: string; days: number }
  /** Keys: sent, delivery_rate, open_rate, click_rate, bounce_rate, complaint_rate, unsubscribes. */
  kpis: Kpi[]
  /** One point per day of the current period (missing days are zero). */
  series: MetricPoint[]
  growth: AudienceGrowthPoint[]
  health: DeliverabilityHealth
  topBroadcasts: TopBroadcast[]
  onboarding: OnboardingStatus
}

export interface LinkClickStat {
  url: string
  clicks: number
  uniqueClicks: number
}

export interface BroadcastTimelinePoint {
  date: string
  opens: number
  clicks: number
  granularity: 'hour' | 'day'
}

export interface BroadcastReport {
  broadcastId: string
  name: string
  status: BroadcastStatus
  startedAt: string | null
  completedAt: string | null
  totals: {
    recipients: number
    queued: number
    sent: number
    delivered: number
    bounced: number
    complained: number
    failed: number
    suppressed: number
    uniqueOpens: number
    uniqueClicks: number
    unsubscribed: number
  }
  rates: {
    delivery: number
    open: number
    click: number
    clickToOpen: number
    bounce: number
    complaint: number
    unsubscribe: number
  }
  /** Hourly for the first 48h after sending started, daily afterwards. */
  timeline: BroadcastTimelinePoint[]
  links: LinkClickStat[]
  domains: { domain: string; recipients: number; delivered: number; opens: number }[]
}
