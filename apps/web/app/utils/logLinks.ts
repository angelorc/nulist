import type { RouteLocationRaw } from 'vue-router'
import type { MessageKind, MessageStatus } from '#shared/types/domain'
import type {
  ActorType,
  EmailEngagement,
  EmailOutcome,
  HttpMethod,
  InboundStatus,
  LogPeriod,
  StatusClass
} from '#shared/types/logs'

export interface DateRangeValue {
  period?: LogPeriod
  from?: string
  to?: string
}

export interface EmailLogLink extends DateRangeValue {
  id?: string
  q?: string
  outcome?: EmailOutcome
  status?: MessageStatus[]
  kind?: MessageKind[]
  engagement?: EmailEngagement[]
  broadcastId?: string
  contactId?: string
  templateId?: string
  recipient?: string
}

export interface ApiLogLink extends DateRangeValue {
  id?: string
  q?: string
  status?: StatusClass[]
  method?: HttpMethod[]
  apiKeyId?: string
}

export interface EventLogLink extends DateRangeValue {
  id?: string
  q?: string
  status?: InboundStatus[]
  eventType?: string[]
  recipient?: string
}

export interface AuditLink extends DateRangeValue {
  id?: string
  q?: string
  entityType?: string
  entityId?: string
  actorType?: ActorType[]
}

/** Statuses of emails the provider accepted: what the sent counts include. */
export const SENT_STATUSES = [
  'sent',
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'rejected'
] as const satisfies readonly MessageStatus[]

/** Statuses of emails that reached the inbox (a complaint follows a delivery). */
export const DELIVERED_STATUSES = [
  'delivered',
  'complained'
] as const satisfies readonly MessageStatus[]

type LinkValue = string | number | string[] | undefined

/**
 * Deep links into the Logs and Audit pages, in the query shape their filters read
 * (lists comma-joined, empty values dropped).
 *
 * <UButton :to="LogLinks.emails({ contactId: contact.id, engagement: ['opened', 'clicked'] })" />
 */
export class LogLinks {
  static emails(filters: EmailLogLink = {}): RouteLocationRaw {
    return LogLinks.to('/logs', { tab: 'emails', ...filters })
  }

  static api(filters: ApiLogLink = {}): RouteLocationRaw {
    return LogLinks.to('/logs', { tab: 'api', ...filters })
  }

  static events(filters: EventLogLink = {}): RouteLocationRaw {
    return LogLinks.to('/logs', { tab: 'events', ...filters })
  }

  static audit(filters: AuditLink = {}): RouteLocationRaw {
    return LogLinks.to('/audit', { ...filters })
  }

  static query(values: Record<string, LinkValue>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).flatMap(([key, value]) => {
        const text = Array.isArray(value) ? value.join(',') : value?.toString()

        return text ? [[key, text]] : []
      })
    )
  }

  private static to(path: string, values: Record<string, LinkValue>): RouteLocationRaw {
    return { path, query: LogLinks.query(values) }
  }
}
