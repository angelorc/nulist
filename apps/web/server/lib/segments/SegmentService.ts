import { and, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { broadcasts, contacts, lists, segments } from '../../db/schema'
import { describeSegmentRules, segmentListIds } from '../../../shared/schemas/segments'
import type { SegmentInput } from '../../../shared/schemas/segments'
import type { ContactStatus, Paginated, SegmentRules } from '../../../shared/types/domain'
import { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ConflictError, NotFoundError, ValidationError } from '../core/errors'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'
import type { LimitService } from '../limits/LimitService'
import type { SegmentQueryBuilder } from './SegmentQueryBuilder'

export type SegmentRow = typeof segments.$inferSelect

export interface SegmentWithCount extends SegmentRow {
  /** Live number of matching contacts (null when the rules could not be evaluated). */
  contactCount: number | null
  /** One-sentence description of the rules. */
  summary: string
}

export interface SegmentContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  createdAt: Date
}

export interface SegmentContactsQuery {
  page: number
  pageSize: number
  q?: string
}

/** Broadcast states during which the audience definition must stay resolvable. */
const ACTIVE_BROADCAST_STATUSES = ['scheduled', 'sending', 'paused'] as const

/**
 * Rule-based, dynamic audiences of one organization: membership is evaluated
 * live from the rules, over the organization's contacts only. Segments of
 * another organization behave exactly like missing ones (404).
 */
export class SegmentService {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly audit: AuditLogger,
    protected readonly limits: LimitService,
    protected readonly builder: SegmentQueryBuilder
  ) {}

  /** Every segment with its live contact count (all counted in one query) and a summary sentence. */
  async list(): Promise<SegmentWithCount[]> {
    const [rows, listNames] = await Promise.all([
      this.db
        .select()
        .from(segments)
        .where(this.scope.eq(segments.organizationId))
        .orderBy(desc(segments.updatedAt)),
      this.listNames()
    ])

    const counts = await this.countAll(rows.map((row) => row.rules))

    return rows.map((row, i) => ({
      ...row,
      contactCount: counts[i] ?? null,
      summary: this.describe(row.rules, listNames)
    }))
  }

  async get(id: string): Promise<SegmentWithCount> {
    const row = await this.findOrFail(id)

    const [contactCount, listNames] = await Promise.all([
      this.safeCount(row.rules),
      this.listNames()
    ])

    return { ...row, contactCount, summary: this.describe(row.rules, listNames) }
  }

  async findOrFail(id: string): Promise<SegmentRow> {
    const [row] = await this.db
      .select()
      .from(segments)
      .where(and(this.scope.eq(segments.organizationId), eq(segments.id, id)))

    if (!row) throw new NotFoundError('Segment', id)

    return row
  }

  async create(input: SegmentInput, actor: Actor): Promise<SegmentRow> {
    await this.limits.assertCanCreate('segments')
    // Compile once so invalid rules fail before anything is stored.
    this.builder.build(input.rules, this.scope)
    await this.assertOwnLists(input.rules)

    const [row] = await this.db
      .insert(segments)
      .values(
        this.scope.values({
          name: input.name,
          description: input.description ?? null,
          rules: input.rules
        })
      )
      .returning()

    if (!row) throw new Error('Segment insert returned no row')
    await this.audit.log(actor, {
      action: 'segment.created',
      entityType: 'segment',
      entityId: row.id,
      summary: `Created segment "${row.name}"`,
      changes: { rules: row.rules }
    })

    return row
  }

  async update(id: string, input: Partial<SegmentInput>, actor: Actor): Promise<SegmentRow> {
    const before = await this.findOrFail(id)

    if (input.rules) {
      this.builder.build(input.rules, this.scope)
      // Lists already referenced were checked when saved (deleted ones simply match nobody).
      await this.assertOwnLists(input.rules, segmentListIds(before.rules))
    }

    const patch: Partial<typeof segments.$inferInsert> = {}

    if (input.name !== undefined) patch.name = input.name

    if (input.description !== undefined) patch.description = input.description

    if (input.rules !== undefined) patch.rules = input.rules

    if (!Object.keys(patch).length) return before

    const [row] = await this.db
      .update(segments)
      .set(patch)
      .where(and(this.scope.eq(segments.organizationId), eq(segments.id, id)))
      .returning()

    if (!row) throw new NotFoundError('Segment', id)
    await this.audit.log(actor, {
      action: 'segment.updated',
      entityType: 'segment',
      entityId: id,
      summary: `Updated segment "${row.name}"`,
      changes: AuditLogger.diff(before, row)
    })

    return row
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const segment = await this.findOrFail(id)

    const [inUse] = await this.db
      .select({ name: broadcasts.name, status: broadcasts.status })
      .from(broadcasts)
      .where(
        and(
          this.scope.eq(broadcasts.organizationId),
          inArray(broadcasts.status, [...ACTIVE_BROADCAST_STATUSES]),
          sql`(${broadcasts.audience} -> 'segmentIds') ? ${id}::text`
        )
      )
      .limit(1)

    if (inUse) {
      throw new ConflictError(
        `Segment is used by the ${inUse.status} broadcast "${inUse.name}". Cancel it or change its audience first.`,
        'segment_in_use'
      )
    }

    await this.db
      .delete(segments)
      .where(and(this.scope.eq(segments.organizationId), eq(segments.id, id)))
    await this.audit.log(actor, {
      action: 'segment.deleted',
      entityType: 'segment',
      entityId: id,
      summary: `Deleted segment "${segment.name}"`
    })
  }

  /** Number of the organization's contacts (any status) matching the rules. */
  async count(rules: SegmentRules): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(contacts)
      .where(this.builder.build(rules, this.scope))

    return row?.value ?? 0
  }

  /** The organization's most recently created contacts matching the rules. */
  async preview(rules: SegmentRules, limit = 5): Promise<SegmentContact[]> {
    return this.db
      .select(this.contactColumns())
      .from(contacts)
      .where(this.builder.build(rules, this.scope))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(Math.min(Math.max(limit, 1), 50))
  }

  /** Matching contacts of a saved segment, newest first, optionally filtered by email. */
  async contacts(
    segmentId: string,
    query: SegmentContactsQuery
  ): Promise<Paginated<SegmentContact>> {
    const segment = await this.findOrFail(segmentId)
    const page = Page.from(query)

    const where = and(
      this.builder.build(segment.rules, this.scope),
      query.q ? ilike(contacts.email, containsPattern(query.q)) : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db
        .select(this.contactColumns())
        .from(contacts)
        .where(where)
        .orderBy(desc(contacts.createdAt), desc(contacts.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(contacts).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  /** Whether one contact currently matches a saved segment. */
  async matches(segmentId: string, contactId: string): Promise<boolean> {
    const segment = await this.findOrFail(segmentId)

    const [row] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), this.builder.build(segment.rules, this.scope)))
      .limit(1)

    return Boolean(row)
  }

  /**
   * Compiled predicate of a saved segment, for composing into other queries.
   * It only matches contacts of the organization.
   */
  async condition(segmentId: string): Promise<SQL> {
    const segment = await this.findOrFail(segmentId)

    return this.builder.build(segment.rules, this.scope)
  }

  /**
   * Every list referenced by the rules must be a list of the organization.
   * `trusted` ids (already stored on the segment) are not checked again.
   */
  private async assertOwnLists(
    rules: SegmentRules,
    trusted: readonly string[] = []
  ): Promise<void> {
    const skip = new Set(trusted)
    const ids = segmentListIds(rules).filter((id) => !skip.has(id))

    if (!ids.length) return

    const rows = await this.db
      .select({ id: lists.id })
      .from(lists)
      .where(and(this.scope.eq(lists.organizationId), inArray(lists.id, ids)))

    const known = new Set(rows.map((row) => row.id))
    const missing = new Set(ids.filter((id) => !known.has(id)))

    if (!missing.size) return

    const issues = rules.conditions.flatMap((condition, index) =>
      condition.field === 'list' && missing.has(String(condition.value))
        ? [{ path: ['conditions', String(index), 'value'], message: 'Choose a list' }]
        : []
    )

    throw new ValidationError('A condition refers to a list that does not exist', { issues })
  }

  private contactColumns() {
    return {
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      status: contacts.status,
      createdAt: contacts.createdAt
    }
  }

  /**
   * Live counts of several rule sets in one pass over the organization's contacts: one
   * connection and one scan however many segments there are. Rules that don't compile, or
   * a failed query, count as null.
   */
  private async countAll(ruleSets: readonly SegmentRules[]): Promise<(number | null)[]> {
    const columns: Record<string, SQL<number>> = {}

    ruleSets.forEach((rules, i) => {
      const filter = this.compileOrNull(rules)

      if (filter) columns[`s${i}`] = sql<number>`count(*) filter (where ${filter})`.mapWith(Number)
    })

    if (!Object.keys(columns).length) return ruleSets.map(() => null)

    try {
      const [row] = await this.db
        .select(columns)
        .from(contacts)
        .where(this.scope.eq(contacts.organizationId))

      return ruleSets.map((_, i) => row?.[`s${i}`] ?? null)
    } catch (error) {
      console.error('[segments] failed to count segments', error)

      return ruleSets.map(() => null)
    }
  }

  private compileOrNull(rules: SegmentRules): SQL | null {
    try {
      return this.builder.build(rules, this.scope)
    } catch (error) {
      console.error('[segments] failed to compile segment rules', error)

      return null
    }
  }

  private async safeCount(rules: SegmentRules): Promise<number | null> {
    try {
      return await this.count(rules)
    } catch (error) {
      console.error('[segments] failed to count segment', error)

      return null
    }
  }

  private async listNames(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(this.scope.eq(lists.organizationId))

    return new Map(rows.map((r) => [r.id, r.name]))
  }

  private describe(rules: SegmentRules, listNames: Map<string, string>): string {
    try {
      return describeSegmentRules(rules, { listName: (id) => listNames.get(id) })
    } catch {
      return 'Invalid rules'
    }
  }
}
