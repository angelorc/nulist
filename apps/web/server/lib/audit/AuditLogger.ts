import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Executor } from '../../db/client'
import { auditLogs } from '../../db/schema'
import type { JsonObject, JsonValue } from '../../../shared/types/domain'
import type { auditQuerySchema } from '../../../shared/schemas/logs'
import type { AuditFacetKey, AuditFacets } from '../../../shared/types/logs'
import type { Actor } from '../core/actor'
import { toJsonObject } from '../core/json'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'
import { FacetCounter } from '../logs/FacetCounter'
import { LogWindow } from '../logs/LogWindow'

/**
 * One audit entry. `changes` is any JSON-serializable object: it is stored as
 * JSON (Dates become ISO strings, undefined fields are dropped).
 */
export interface AuditEntry<C extends object = JsonObject> {
  action: string
  entityType: string
  entityId?: string | null
  summary: string
  changes?: C | null
}

export type AuditQuery = z.infer<typeof auditQuerySchema>

const HIGH_CARDINALITY_LIMIT = 20

export interface AuditFieldChange {
  from: JsonValue
  to: JsonValue
}

/** Changed fields of an entity, by field name. */
export interface AuditDiff {
  [field: string]: AuditFieldChange
}

/** The JSON form of a value, as Postgres stores it in a jsonb column. */
function asJson(value: string | undefined): JsonValue {
  return value === undefined ? null : z.json().parse(JSON.parse(value))
}

/**
 * Append-only audit trail: who did what, to which entity, with before/after diff.
 * Scoped to one organization; the root container's logger (no scope) records
 * instance-level actions (organization management) under the actor's organization.
 */
export class AuditLogger {
  constructor(
    protected readonly scope: TenantScope | null,
    private readonly db: Database
  ) {}

  async log<C extends object>(
    actor: Actor,
    entry: AuditEntry<C>,
    tx: Executor = this.db
  ): Promise<void> {
    const changes = entry.changes ? toJsonObject(entry.changes) : null

    await tx.insert(auditLogs).values({
      organizationId: this.scope?.organizationId ?? actor.organizationId,
      actorType: actor.type,
      actorId: actor.id,
      actorLabel: actor.label,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null
    })
  }

  /** Shallow diff of two records, limited to the fields that changed (timestamps ignored). */
  static diff<T extends object>(before: T, after: T): AuditDiff {
    const left = new Map(Object.entries(before))
    const right = new Map(Object.entries(after))
    const changes: AuditDiff = {}

    for (const key of new Set([...left.keys(), ...right.keys()])) {
      if (key === 'updatedAt' || key === 'createdAt') continue
      const from = JSON.stringify(left.get(key))
      const to = JSON.stringify(right.get(key))

      if (from !== to) changes[key] = { from: asJson(from), to: asJson(to) }
    }

    return changes
  }

  private filters(query: Omit<AuditQuery, 'page' | 'pageSize'>): SQL | undefined {
    const { from, to } = LogWindow.bounds(query)

    // Without a scope only instance-level entries are listed, never another organization's.
    return and(
      this.scope ? this.scope.eq(auditLogs.organizationId) : isNull(auditLogs.organizationId),
      query.entityType ? inArray(auditLogs.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
      query.actorType ? inArray(auditLogs.actorType, query.actorType) : undefined,
      query.action ? inArray(auditLogs.action, query.action) : undefined,
      from ? gte(auditLogs.createdAt, from) : undefined,
      to ? lt(auditLogs.createdAt, to) : undefined,
      query.q
        ? or(
            ilike(auditLogs.summary, containsPattern(query.q)),
            ilike(auditLogs.action, containsPattern(query.q)),
            ilike(auditLogs.actorLabel, containsPattern(query.q))
          )
        : undefined
    )
  }

  async list(query: AuditQuery) {
    const page = Page.from(query)
    const filters = this.filters(query)

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(filters)
        .orderBy(desc(auditLogs.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(auditLogs).where(filters)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  async facets(query: AuditQuery): Promise<AuditFacets> {
    const facets = new FacetCounter<AuditFacetKey>(
      this.db,
      auditLogs,
      (key) => this.filters({ ...query, [key]: undefined }),
      query
    )

    const [actorType, entityType, action] = await Promise.all([
      facets.count('actorType', { value: auditLogs.actorType }),
      facets.count('entityType', { value: auditLogs.entityType, limit: HIGH_CARDINALITY_LIMIT }),
      facets.count('action', { value: auditLogs.action, limit: HIGH_CARDINALITY_LIMIT })
    ])

    return { facets: { actorType, entityType, action } }
  }
}
