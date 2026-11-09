import { eq, sql } from 'drizzle-orm'
import type { Column, SQL } from 'drizzle-orm'

/**
 * The organization a service instance works for. Every tenant service receives
 * it as its first constructor argument and uses it on every query:
 * `where(and(scope.eq(table.organizationId), ...))` and `values(scope.values({...}))`.
 * Immutable, so one instance can be shared by every service of an organization.
 */
export class TenantScope {
  constructor(readonly organizationId: string) {
    Object.freeze(this)
  }

  /** `<column> = <organization id>` for drizzle `where` clauses. */
  eq(column: Column): SQL {
    return eq(column, this.organizationId)
  }

  /**
   * `<alias>.organization_id = <organization id>::uuid` for raw SQL where a table
   * is referenced through an alias (`eq` renders the table-qualified column).
   */
  sql(alias: string): SQL {
    return sql`${sql.identifier(alias)}.organization_id = ${this.organizationId}::uuid`
  }

  /** The organization id as a bound uuid parameter for raw SQL. */
  get id(): SQL {
    return sql`${this.organizationId}::uuid`
  }

  /** Row for an insert into a tenant table. */
  values<T extends object>(row: T): T & { organizationId: string } {
    return { ...row, organizationId: this.organizationId }
  }

  /** Rows for a bulk insert into a tenant table. */
  valuesMany<T extends object>(rows: readonly T[]): (T & { organizationId: string })[] {
    return rows.map((row) => this.values(row))
  }

  /** Whether `organizationId` (from a row, a token or a tag) belongs to this scope. */
  owns(organizationId: string | null | undefined): boolean {
    return organizationId === this.organizationId
  }
}
