import { and, count, desc, eq, gte, ilike, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Executor } from '../../db/client'
import { auditLogs } from '../../db/schema'
import type { JsonObject, JsonValue } from '../../../shared/types/domain'
import type { ActorType, LogPeriod } from '../../../shared/types/logs'
import type { Actor } from '../core/actor'
import { toJsonObject } from '../core/json'
import { Page } from '../core/pagination'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'
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

export interface AuditQuery {
  page: number
  pageSize: number
  q?: string
  entityType?: string
  entityId?: string
  actorType?: ActorType
  period?: LogPeriod
}

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

  async list(query: AuditQuery) {
    const page = Page.from(query)
    const from = LogWindow.since(query.period)

    // Without a scope only instance-level entries are listed, never another organization's.
    const filters = and(
      this.scope ? this.scope.eq(auditLogs.organizationId) : isNull(auditLogs.organizationId),
      query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
      query.actorType ? eq(auditLogs.actorType, query.actorType) : undefined,
      from ? gte(auditLogs.createdAt, from) : undefined,
      query.q
        ? or(
            ilike(auditLogs.summary, containsPattern(query.q)),
            ilike(auditLogs.action, containsPattern(query.q)),
            ilike(auditLogs.actorLabel, containsPattern(query.q))
          )
        : undefined
    )

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
}
