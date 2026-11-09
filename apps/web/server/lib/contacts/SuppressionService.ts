import { and, count, desc, eq, ilike, inArray } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { suppressions } from '../../db/schema'
import type { MessageKind, SuppressionReason } from '../../../shared/types/domain'
import { InvalidStateError } from '../core/errors'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

/** Reasons that block every email, including transactional ones. */
const HARD_REASONS: ReadonlySet<SuppressionReason> = new Set<SuppressionReason>([
  'hard_bounce',
  'complaint',
  'manual'
])

export interface SuppressionQuery {
  page: number
  pageSize: number
  q?: string
  reason?: SuppressionReason
}

/**
 * The organization's suppression list, checked before every send.
 * Transactional and system mail ignore unsubscribes but never bounces or complaints.
 */
export class SuppressionService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  static normalize(email: string) {
    return email.trim().toLowerCase()
  }

  async find(email: string, tx: Executor = this.db) {
    const [row] = await tx
      .select()
      .from(suppressions)
      .where(
        and(
          this.scope.eq(suppressions.organizationId),
          eq(suppressions.email, SuppressionService.normalize(email))
        )
      )

    return row ?? null
  }

  /** Returns the blocking reason, or null when the address may receive this kind of email. */
  async blockingReason(email: string, kind: MessageKind): Promise<SuppressionReason | null> {
    const row = await this.find(email)

    if (!row) return null

    if (HARD_REASONS.has(row.reason)) return row.reason

    return kind === 'transactional' || kind === 'system' ? null : row.reason
  }

  async add(email: string, reason: SuppressionReason, source: string, tx: Executor = this.db) {
    const [row] = await tx
      .insert(suppressions)
      .values(this.scope.values({ email: SuppressionService.normalize(email), reason, source }))
      .onConflictDoUpdate({
        target: [suppressions.organizationId, suppressions.email],
        set: { reason, source }
      })
      .returning()

    if (!row) throw new InvalidStateError('Could not record the suppression')

    return row
  }

  /**
   * Lifts the suppression. With `reasons`, only a row that still has one of them is deleted:
   * the check is part of the DELETE, so a bounce or complaint recorded meanwhile stays.
   */
  async remove(
    email: string,
    tx: Executor = this.db,
    options: { reasons?: readonly SuppressionReason[] } = {}
  ): Promise<boolean> {
    const rows = await tx
      .delete(suppressions)
      .where(
        and(
          this.scope.eq(suppressions.organizationId),
          eq(suppressions.email, SuppressionService.normalize(email)),
          options.reasons ? inArray(suppressions.reason, [...options.reasons]) : undefined
        )
      )
      .returning()

    return rows.length > 0
  }

  async list(query: SuppressionQuery) {
    const page = Page.from(query)

    const where = and(
      this.scope.eq(suppressions.organizationId),
      query.q ? ilike(suppressions.email, containsPattern(query.q.toLowerCase())) : undefined,
      query.reason ? eq(suppressions.reason, query.reason) : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(suppressions)
        .where(where)
        .orderBy(desc(suppressions.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(suppressions).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }
}
