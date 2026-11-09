import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, files, lists, messages, segments, templates } from '../../db/schema'
import type { LimitSettings, LimitUsage } from '../../../shared/types/domain'
import type { SettingsService } from '../settings/SettingsService'
import { LimitExceededError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'

export type CountedResource = 'contacts' | 'lists' | 'segments' | 'templates'

const RESOURCE_LIMIT = {
  contacts: 'maxContacts',
  lists: 'maxLists',
  segments: 'maxSegments',
  templates: 'maxTemplates'
} as const satisfies Record<CountedResource, keyof LimitSettings>

const COUNTED_TABLES = { contacts, lists, segments, templates } as const

/** Transactional emails accepted but not yet handed to the provider. */
const PENDING_STATUSES = ['queued', 'scheduled', 'sending'] as const

const DAY_MS = 86_400_000

/** One send window (Settings → Limits): its limit and when it started. */
interface SendWindow {
  limit: number
  since: Date
}

/**
 * Enforces one organization's quotas (Settings → Limits, set by the instance
 * administrator; 0 = unlimited) and reports its usage.
 */
export class LimitService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly settings: SettingsService
  ) {}

  private async limits() {
    return this.settings.get('limits')
  }

  private async countResource(resource: CountedResource): Promise<number> {
    const table = COUNTED_TABLES[resource]

    const [row] = await this.db
      .select({ value: count() })
      .from(table)
      .where(this.scope.eq(table.organizationId))

    return row?.value ?? 0
  }

  /**
   * Messages handed to the provider since `since`. `sent_at` is only set once the
   * provider accepted a message, so it alone decides (index-only on (organization, sent_at)).
   */
  async sentSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(messages)
      .where(and(this.scope.eq(messages.organizationId), gte(messages.sentAt, since)))

    return row?.value ?? 0
  }

  /** Transactional emails accepted (queued or scheduled) but not handed to the provider yet. */
  async pendingTransactional(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          inArray(messages.status, [...PENDING_STATUSES]),
          eq(messages.kind, 'transactional'),
          isNull(messages.sentAt)
        )
      )

    return row?.value ?? 0
  }

  async assertCanCreate(resource: CountedResource, adding = 1): Promise<void> {
    const max = (await this.limits())[RESOURCE_LIMIT[resource]]

    if (!max) return
    const used = await this.countResource(resource)

    if (used + adding > max) throw new LimitExceededError(resource, used, max)
  }

  /** How many contacts can still be created (Infinity when unlimited). */
  async remainingContacts(): Promise<number> {
    const max = (await this.limits()).maxContacts

    if (!max) return Number.POSITIVE_INFINITY

    return Math.max(0, max - (await this.countResource('contacts')))
  }

  /** The configured send windows (none when sending is unlimited). */
  private async sendWindows(): Promise<SendWindow[]> {
    const limits = await this.limits()
    const windows: SendWindow[] = []

    if (limits.dailySendLimit)
      windows.push({ limit: limits.dailySendLimit, since: new Date(Date.now() - DAY_MS) })

    if (limits.monthlySendLimit) {
      const monthStart = new Date()
      monthStart.setUTCDate(1)
      monthStart.setUTCHours(0, 0, 0, 0)
      windows.push({ limit: limits.monthlySendLimit, since: monthStart })
    }

    return windows
  }

  /** Smallest `limit - sent - reserved` across `windows` (Infinity when there is none). */
  private async capacity(windows: SendWindow[], reserved: number): Promise<number> {
    if (!windows.length) return Number.POSITIVE_INFINITY

    const left = await Promise.all(
      windows.map(async (w) => w.limit - (await this.sentSince(w.since)) - reserved)
    )

    return Math.max(0, Math.min(...left))
  }

  /**
   * Capacity left for new emails across the daily and monthly windows (Infinity when
   * unlimited): sent emails plus accepted transactional emails not sent yet, so
   * queued or scheduled emails cannot oversubscribe a window and broadcasts leave
   * room for them.
   */
  async remainingSendCapacity(): Promise<number> {
    const windows = await this.sendWindows()

    if (!windows.length) return Number.POSITIVE_INFINITY

    return this.capacity(windows, await this.pendingTransactional())
  }

  /**
   * Capacity left when an already accepted email is delivered: only emails handed
   * to the provider count. Infinity when unlimited.
   */
  async remainingDeliveryCapacity(): Promise<number> {
    return this.capacity(await this.sendWindows(), 0)
  }

  async assertCanSend(sending = 1): Promise<void> {
    const remaining = await this.remainingSendCapacity()

    if (remaining < sending) {
      const limits = await this.limits()
      throw new LimitExceededError(
        'sending',
        (limits.dailySendLimit || limits.monthlySendLimit) - remaining,
        limits.dailySendLimit || limits.monthlySendLimit
      )
    }
  }

  async assertImportRows(rows: number): Promise<void> {
    const max = (await this.limits()).maxImportRows

    if (max && rows > max) throw new LimitExceededError('import rows', rows, max)
  }

  async assertUpload(bytes: number): Promise<void> {
    const limits = await this.limits()

    if (limits.maxFileSizeMb && bytes > limits.maxFileSizeMb * 1024 * 1024) {
      throw new LimitExceededError(
        'file size (MB)',
        Math.ceil(bytes / 1024 / 1024),
        limits.maxFileSizeMb
      )
    }

    if (limits.maxStorageMb) {
      const used = await this.storageBytes()

      if (used + bytes > limits.maxStorageMb * 1024 * 1024) {
        throw new LimitExceededError(
          'storage (MB)',
          Math.ceil(used / 1024 / 1024),
          limits.maxStorageMb
        )
      }
    }
  }

  private async storageBytes(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<string>`coalesce(sum(${files.size}), 0)::bigint` })
      .from(files)
      .where(this.scope.eq(files.organizationId))

    return Number(row?.value ?? 0)
  }

  async usage(): Promise<LimitUsage[]> {
    const limits = await this.limits()
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)

    const [c, l, s, t, day, month, storage] = await Promise.all([
      this.countResource('contacts'),
      this.countResource('lists'),
      this.countResource('segments'),
      this.countResource('templates'),
      this.sentSince(new Date(Date.now() - DAY_MS)),
      this.sentSince(monthStart),
      this.storageBytes()
    ])

    return [
      { key: 'maxContacts', label: 'Contacts', used: c, limit: limits.maxContacts },
      { key: 'maxLists', label: 'Lists', used: l, limit: limits.maxLists },
      { key: 'maxSegments', label: 'Segments', used: s, limit: limits.maxSegments },
      { key: 'maxTemplates', label: 'Templates', used: t, limit: limits.maxTemplates },
      {
        key: 'dailySendLimit',
        label: 'Emails (last 24h)',
        used: day,
        limit: limits.dailySendLimit
      },
      {
        key: 'monthlySendLimit',
        label: 'Emails (this month)',
        used: month,
        limit: limits.monthlySendLimit
      },
      {
        key: 'maxStorageMb',
        label: 'File storage',
        used: Math.round((storage / 1024 / 1024) * 10) / 10,
        limit: limits.maxStorageMb,
        unit: 'MB'
      }
    ]
  }
}
