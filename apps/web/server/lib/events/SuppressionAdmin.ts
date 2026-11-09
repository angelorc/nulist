import { and, count, desc, eq, ilike } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, suppressions } from '../../db/schema'
import type { ContactStatus, SuppressionReason } from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ConflictError, NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import { SuppressionService } from '../contacts/SuppressionService'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export interface SuppressionListQuery {
  page: number
  pageSize: number
  q?: string
  reason?: SuppressionReason
}

export interface SuppressionListItem {
  id: string
  email: string
  reason: SuppressionReason
  source: string | null
  createdAt: Date
  contactId: string | null
  contactStatus: ContactStatus | null
}

export interface SuppressionRemoval {
  email: string
  reason: SuppressionReason
  /** The contact keeps its status (bounced, complained…): removal only lifts the send block. */
  contact: { id: string; status: ContactStatus } | null
}

/**
 * Dashboard operations on the organization's suppression list: browsing with
 * the matching contact, manual additions and removals, all audited.
 * Wraps the organization's SuppressionService, which stays the single writer
 * of the table.
 */
export class SuppressionAdmin {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly suppressionList: SuppressionService,
    private readonly audit: AuditLogger
  ) {}

  async list(query: SuppressionListQuery) {
    const page = Page.from(query)

    const where = and(
      this.scope.eq(suppressions.organizationId),
      query.q ? ilike(suppressions.email, containsPattern(query.q.toLowerCase())) : undefined,
      query.reason ? eq(suppressions.reason, query.reason) : undefined
    )

    const [items, [total], byReason] = await Promise.all([
      this.db
        .select({
          id: suppressions.id,
          email: suppressions.email,
          reason: suppressions.reason,
          source: suppressions.source,
          createdAt: suppressions.createdAt,
          contactId: contacts.id,
          contactStatus: contacts.status
        })
        .from(suppressions)
        // Email is unique per organization only: join within the organization.
        .leftJoin(
          contacts,
          and(
            eq(contacts.organizationId, suppressions.organizationId),
            eq(contacts.email, suppressions.email)
          )
        )
        .where(where)
        .orderBy(desc(suppressions.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(suppressions).where(where),
      this.db
        .select({ reason: suppressions.reason, value: count() })
        .from(suppressions)
        .where(this.scope.eq(suppressions.organizationId))
        .groupBy(suppressions.reason)
    ])

    const counts: Partial<Record<SuppressionReason, number>> = {}

    for (const row of byReason) counts[row.reason] = row.value

    return { ...page.wrap<SuppressionListItem>(items, total?.value ?? 0), counts }
  }

  async add(email: string, actor: Actor) {
    const normalized = SuppressionService.normalize(email)
    const existing = await this.suppressionList.find(normalized)

    if (existing) {
      throw new ConflictError(
        `${normalized} is already suppressed (${existing.reason.replace('_', ' ')})`,
        'already_suppressed',
        { reason: existing.reason }
      )
    }

    const row = await this.db.transaction(async (tx) => {
      const created = await this.suppressionList.add(
        normalized,
        'manual',
        `Added by ${actor.label}`,
        tx
      )

      await this.audit.log(
        actor,
        {
          action: 'suppression.created',
          entityType: 'suppression',
          entityId: created.id,
          summary: `Suppressed ${normalized}`,
          changes: { reason: { from: null, to: 'manual' } }
        },
        tx
      )

      return created
    })

    return row
  }

  async remove(email: string, actor: Actor): Promise<SuppressionRemoval> {
    const normalized = SuppressionService.normalize(email)
    const existing = await this.suppressionList.find(normalized)

    if (!existing) throw new NotFoundError('Suppression for', normalized)
    await this.suppressionList.remove(normalized)
    await this.audit.log(actor, {
      action: 'suppression.deleted',
      entityType: 'suppression',
      entityId: existing.id,
      summary: `Removed ${normalized} from the suppression list (${existing.reason.replace('_', ' ')})`,
      changes: { reason: { from: existing.reason, to: null } }
    })

    const [contact] = await this.db
      .select({ id: contacts.id, status: contacts.status })
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.email, normalized)))

    return { email: normalized, reason: existing.reason, contact: contact ?? null }
  }
}
