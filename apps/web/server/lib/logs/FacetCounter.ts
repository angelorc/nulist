import { and, count, desc, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '../../db/client'
import type { FacetBucket } from '../../../shared/types/logs'

/** Display name of a facet value, read from a joined table; `id` and `scope` look up selected values that match no rows. */
export interface FacetLabel {
  table: PgTable
  on: SQL
  name: AnyColumn | SQL
  id: AnyColumn
  scope: SQL
}

/** One facet: the grouped value (rows where it is null are not counted), its label, how many values to return. */
export interface Facet {
  value: AnyColumn | SQL
  label?: FacetLabel
  limit?: number
}

/**
 * Disjunctive facet counts over one table: each facet is counted with every
 * filter of the query except its own (`filters(key)` leaves that key out), so a
 * selection never hides the other values of its group while the other groups
 * narrow. Buckets are ordered by count; values selected in the query are always
 * present (with 0 when nothing matches). The filters carry the tenant scope.
 */
export class FacetCounter<K extends string> {
  constructor(
    private readonly db: Database,
    private readonly table: PgTable,
    private readonly filters: (except: K) => SQL | undefined,
    private readonly selected: Partial<Record<K, readonly string[]>>
  ) {}

  async count(key: K, facet: Facet): Promise<FacetBucket[]> {
    const where = and(this.filters(key), isNotNull(facet.value))
    const top = await this.run(facet, where, facet.limit)
    const listed = new Set(top.map((bucket) => bucket.value))
    const missing = (this.selected[key] ?? []).filter((value) => !listed.has(value))

    if (!missing.length) return top

    const [found, labels] = await Promise.all([
      this.run(facet, and(where, inArray(sql`${facet.value}`, missing))),
      this.labels(facet.label, missing)
    ])

    const byValue = new Map(found.map((bucket) => [bucket.value, bucket]))

    return [
      ...top,
      ...missing.map(
        (value) => byValue.get(value) ?? { value, label: labels.get(value) ?? null, count: 0 }
      )
    ]
  }

  private async labels(
    label: FacetLabel | undefined,
    values: string[]
  ): Promise<Map<string, string | null>> {
    if (!label) return new Map()

    const rows = await this.db
      .select({ id: sql<string>`${label.id}`, name: sql<string | null>`${label.name}` })
      .from(label.table)
      .where(and(label.scope, inArray(label.id, values)))

    return new Map(rows.map((row) => [row.id, row.name]))
  }

  private async run(facet: Facet, where: SQL | undefined, limit?: number): Promise<FacetBucket[]> {
    const label = facet.label

    let query = this.db
      .select({
        value: sql<string>`${facet.value}`,
        label: sql<string | null>`${label ? label.name : sql`null`}`,
        count: count()
      })
      .from(this.table)
      .$dynamic()

    if (label) query = query.leftJoin(label.table, label.on)

    query = query
      .where(where)
      .groupBy(sql`1, 2`)
      .orderBy(desc(count()), sql`1`)

    if (limit) query = query.limit(limit)

    return query
  }
}
