import { isDeepStrictEqual } from 'node:util'
import { and, asc, count, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { broadcasts, contacts, lists, segments, templates, topics } from '../../db/schema'
import {
  describeSegmentRules,
  segmentReferenceIds,
  segmentReferences,
  segmentRulesSchema
} from '../../../shared/schemas/segments'
import type {
  SegmentDescribeContext,
  SegmentInput,
  SegmentReference,
  SegmentReferences
} from '../../../shared/schemas/segments'
import type { ContactSegment } from '../../../shared/types/contacts'
import type { ContactStatus, Paginated, SegmentRules } from '../../../shared/types/domain'
import { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ConflictError, NotFoundError, ValidationError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'
import type { LimitService } from '../limits/LimitService'
import type { SegmentCompileContext } from './SegmentCompileContext'
import { SegmentGraph } from './SegmentGraph'
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

const EVALUATION_BATCH = 20

function inBatches<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / EVALUATION_BATCH) }, (_, i) =>
    items.slice(i * EVALUATION_BATCH, (i + 1) * EVALUATION_BATCH)
  )
}

const SEGMENT_REFERENCE_PATH = '$.** ? (@.field == "segment" && @.value == $id)'

const SELF_REFERENCE_MESSAGE =
  'A segment cannot include itself, directly or through another segment'

type ReferenceKind = keyof SegmentReferences

const REFERENCE_KINDS: ReferenceKind[] = [
  'listIds',
  'segmentIds',
  'topicIds',
  'broadcastIds',
  'templateIds'
]

const REFERENCE_NOUNS: Record<ReferenceKind, string> = {
  listIds: 'list',
  segmentIds: 'segment',
  topicIds: 'topic',
  broadcastIds: 'broadcast',
  templateIds: 'template'
}

interface NamedRow {
  id: string
  name: string
}

function nameResolver(rows: readonly NamedRow[]): (id: string) => string | undefined {
  const names = new Map(rows.map((row) => [row.id, row.name]))

  return (id) => names.get(id)
}

function parsedRules(rules: SegmentRules): SegmentRules | null {
  const parsed = segmentRulesSchema.safeParse(rules)

  return parsed.success ? parsed.data : null
}

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
    protected readonly builder: SegmentQueryBuilder,
    protected readonly jobs: JobLauncher
  ) {}

  /** Every segment with its live contact count (all counted in one query) and a summary sentence. */
  async list(): Promise<SegmentWithCount[]> {
    const rows = await this.db
      .select()
      .from(segments)
      .where(this.scope.eq(segments.organizationId))
      .orderBy(desc(segments.updatedAt))

    const ruleSets = rows.map((row) => row.rules)

    const [counts, names] = await Promise.all([
      this.countAll(ruleSets),
      this.describeContext(ruleSets)
    ])

    return rows.map((row, i) => ({
      ...row,
      contactCount: counts[i] ?? null,
      summary: this.describe(row.rules, names)
    }))
  }

  async get(id: string): Promise<SegmentWithCount> {
    const row = await this.findOrFail(id)

    const [contactCount, names] = await Promise.all([
      this.safeCount(row.rules),
      this.describeContext([row.rules])
    ])

    return { ...row, contactCount, summary: this.describe(row.rules, names) }
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
    await this.builder.build(input.rules)
    await this.assertOwnReferences(input.rules)

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
    await this.jobs.syncSegments(this.scope.organizationId, row.id)

    return row
  }

  async update(id: string, input: Partial<SegmentInput>, actor: Actor): Promise<SegmentRow> {
    const before = await this.findOrFail(id)

    if (input.rules) {
      const graph = await SegmentGraph.load(this.db, this.scope)
      SegmentService.assertAcyclic(id, input.rules, graph)
      await this.builder.build(input.rules)
      await this.assertDependentsCompile(id, input.rules, graph)
      // References already stored were checked when saved (deleted ones simply match nobody).
      await this.assertOwnReferences(input.rules, before.rules)
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

    if (!isDeepStrictEqual(before.rules, row.rules)) {
      await this.jobs.syncSegments(this.scope.organizationId, row.id)
    }

    return row
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const segment = await this.findOrFail(id)

    const [dependent] = await this.db
      .select({ name: segments.name })
      .from(segments)
      .where(
        and(
          this.scope.eq(segments.organizationId),
          ne(segments.id, id),
          sql`jsonb_path_exists(${segments.rules}, ${SEGMENT_REFERENCE_PATH}::jsonpath, jsonb_build_object('id', ${id}::text))`
        )
      )
      .limit(1)

    if (dependent) {
      throw new ConflictError(
        `Segment is used by the segment "${dependent.name}". Remove it there first.`,
        'segment_in_use'
      )
    }

    const [inUse] = await this.db
      .select({ name: broadcasts.name, status: broadcasts.status })
      .from(broadcasts)
      .where(
        and(
          this.scope.eq(broadcasts.organizationId),
          inArray(broadcasts.status, [...ACTIVE_BROADCAST_STATUSES]),
          sql`((${broadcasts.audience} -> 'segmentIds') ? ${id}::text or (${broadcasts.audience} -> 'excludeSegmentIds') ? ${id}::text)`
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
      .where(await this.builder.build(rules))

    return row?.value ?? 0
  }

  /** The organization's most recently created contacts matching the rules. */
  async preview(rules: SegmentRules, limit = 5): Promise<SegmentContact[]> {
    return this.db
      .select(this.contactColumns())
      .from(contacts)
      .where(await this.builder.build(rules))
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
      await this.builder.build(segment.rules),
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
      .where(and(eq(contacts.id, contactId), await this.builder.build(segment.rules)))
      .limit(1)

    return Boolean(row)
  }

  async memberships(contactId: string): Promise<ContactSegment[]> {
    const contact = and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId))
    const [found] = await this.db.select({ id: contacts.id }).from(contacts).where(contact)

    if (!found) throw new NotFoundError('Contact', contactId)

    const rows = await this.db
      .select({ id: segments.id, name: segments.name, rules: segments.rules })
      .from(segments)
      .where(this.scope.eq(segments.organizationId))
      .orderBy(asc(segments.name), asc(segments.id))

    const filters = await this.builder.buildMany(rows.map((row) => row.rules))

    const indexed = filters.flatMap((filter, index) => (filter ? [{ filter, index }] : []))

    const matched = await Promise.all(
      inBatches(indexed).map(async (batch) => {
        const columns: Record<string, SQL<boolean>> = {}

        for (const { filter, index } of batch) {
          columns[`s${index}`] = sql<boolean>`coalesce((${filter}), false)`
        }

        const [row] = await this.db.select(columns).from(contacts).where(contact)

        return batch.flatMap(({ index }) => (row?.[`s${index}`] ? [index] : []))
      })
    )

    const members = new Set(matched.flat())

    return rows.flatMap((row, i) => (members.has(i) ? [{ id: row.id, name: row.name }] : []))
  }

  /**
   * Compiled predicate of a saved segment, for composing into other queries.
   * It only matches contacts of the organization.
   */
  async condition(segmentId: string): Promise<SQL> {
    const segment = await this.findOrFail(segmentId)

    return this.builder.build(segment.rules)
  }

  /**
   * Every list, segment, topic, broadcast and template referenced by the rules must belong to
   * the organization. Ids already stored on the segment (`trusted`) are not checked again.
   */
  private async assertOwnReferences(rules: SegmentRules, trusted?: SegmentRules): Promise<void> {
    const references = segmentReferences(rules)
    const stored = trusted ? parsedRules(trusted) : null
    const known = stored ? segmentReferences(stored) : null

    const missing = await Promise.all(
      REFERENCE_KINDS.map(async (kind) => {
        const skip = new Set(segmentReferenceIds(known?.[kind] ?? []))
        const ids = segmentReferenceIds(references[kind]).filter((id) => !skip.has(id))
        const found = new Set((await this.ownRows(kind, ids)).map((row) => row.id))

        return references[kind].flatMap((reference) =>
          skip.has(reference.id) || found.has(reference.id) ? [] : [{ kind, reference }]
        )
      })
    )

    const issues = missing.flat()

    if (!issues.length) return

    const noun = REFERENCE_NOUNS[issues[0]!.kind]

    throw new ValidationError(`A condition refers to a ${noun} that does not exist`, {
      issues: issues.map(({ kind, reference }) => ({
        path: reference.path.map(String),
        message: `Choose a ${REFERENCE_NOUNS[kind]}`
      }))
    })
  }

  private static assertAcyclic(id: string, rules: SegmentRules, graph: SegmentGraph): void {
    const offending = segmentReferences(rules).segmentIds.filter(
      (reference) => reference.id === id || graph.reaches(reference.id, id)
    )

    if (!offending.length) return

    throw new ValidationError(SELF_REFERENCE_MESSAGE, {
      issues: offending.map((reference) => ({
        path: reference.path.map(String),
        message: SELF_REFERENCE_MESSAGE
      }))
    })
  }

  private async assertDependentsCompile(
    id: string,
    rules: SegmentRules,
    graph: SegmentGraph
  ): Promise<void> {
    const dependents = graph.dependents(id)

    if (!dependents.length) return

    const ruleSets = dependents.map((dependent) => dependent.rules)
    const updated = await this.builder.context(ruleSets, new Map([[id, rules]]))

    const broken = dependents.flatMap((dependent) => {
      const error = this.compileError(dependent.rules, updated)

      return error ? [{ dependent, error }] : []
    })

    if (!broken.length) return

    const current = await this.builder.context(ruleSets)
    const regression = broken.find(({ dependent }) => !this.compileError(dependent.rules, current))

    if (!regression) return

    throw new ValidationError(
      `The segment "${regression.dependent.name}" includes this segment and would stop working: ${regression.error.message}`
    )
  }

  private compileError(
    rules: SegmentRules,
    context: SegmentCompileContext
  ): ValidationError | null {
    try {
      this.builder.compile(rules, context)

      return null
    } catch (error) {
      if (error instanceof ValidationError) return error

      throw error
    }
  }

  private async ownRows(kind: ReferenceKind, ids: string[]): Promise<NamedRow[]> {
    if (!ids.length) return []

    switch (kind) {
      case 'listIds':
        return this.db
          .select({ id: lists.id, name: lists.name })
          .from(lists)
          .where(and(this.scope.eq(lists.organizationId), inArray(lists.id, ids)))
      case 'segmentIds':
        return this.db
          .select({ id: segments.id, name: segments.name })
          .from(segments)
          .where(and(this.scope.eq(segments.organizationId), inArray(segments.id, ids)))
      case 'topicIds':
        return this.db
          .select({ id: topics.id, name: topics.name })
          .from(topics)
          .where(and(this.scope.eq(topics.organizationId), inArray(topics.id, ids)))
      case 'broadcastIds':
        return this.db
          .select({ id: broadcasts.id, name: broadcasts.name })
          .from(broadcasts)
          .where(and(this.scope.eq(broadcasts.organizationId), inArray(broadcasts.id, ids)))
      case 'templateIds':
        return this.db
          .select({ id: templates.id, name: templates.name })
          .from(templates)
          .where(and(this.scope.eq(templates.organizationId), inArray(templates.id, ids)))
    }
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
   * Live counts of several rule sets, one scan of the organization's contacts per batch of
   * segments. Rules that don't compile, or a failed batch, count as null.
   */
  private async countAll(ruleSets: readonly SegmentRules[]): Promise<(number | null)[]> {
    const filters = await this.builder.buildMany(ruleSets)
    const indexed = filters.flatMap((filter, index) => (filter ? [{ filter, index }] : []))
    const counts = new Map<number, number | null>()

    await Promise.all(
      inBatches(indexed).map(async (batch) => {
        const columns: Record<string, SQL<number>> = {}

        for (const { filter, index } of batch) {
          columns[`s${index}`] = sql<number>`count(*) filter (where ${filter})`.mapWith(Number)
        }

        try {
          const [row] = await this.db
            .select(columns)
            .from(contacts)
            .where(this.scope.eq(contacts.organizationId))

          for (const { index } of batch) counts.set(index, row?.[`s${index}`] ?? null)
        } catch (error) {
          console.error('[segments] failed to count segments', error)
        }
      })
    )

    return ruleSets.map((_, i) => counts.get(i) ?? null)
  }

  private async safeCount(rules: SegmentRules): Promise<number | null> {
    try {
      return await this.count(rules)
    } catch (error) {
      console.error('[segments] failed to count segment', error)

      return null
    }
  }

  private async describeContext(
    ruleSets: readonly SegmentRules[]
  ): Promise<SegmentDescribeContext> {
    const references = ruleSets.flatMap((rules) => {
      const parsed = parsedRules(rules)

      return parsed ? [segmentReferences(parsed)] : []
    })

    const ids = (kind: ReferenceKind) =>
      segmentReferenceIds(references.flatMap((reference): SegmentReference[] => reference[kind]))

    const [listRows, segmentRows, topicRows, broadcastRows, templateRows] = await Promise.all([
      this.ownRows('listIds', ids('listIds')),
      this.ownRows('segmentIds', ids('segmentIds')),
      this.ownRows('topicIds', ids('topicIds')),
      this.ownRows('broadcastIds', ids('broadcastIds')),
      this.ownRows('templateIds', ids('templateIds'))
    ])

    return {
      listName: nameResolver(listRows),
      segmentName: nameResolver(segmentRows),
      topicName: nameResolver(topicRows),
      broadcastName: nameResolver(broadcastRows),
      templateName: nameResolver(templateRows)
    }
  }

  private describe(rules: SegmentRules, context: SegmentDescribeContext): string {
    try {
      return describeSegmentRules(rules, context)
    } catch {
      return 'Invalid rules'
    }
  }
}
