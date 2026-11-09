import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { contacts, listSubscriptions } from '../../db/schema'
import type { ContactStatus } from '../../../shared/types/domain'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export interface ContactFilterInput {
  q?: string
  status?: ContactStatus
  listId?: string
  ids?: string[]
}

/** Sortable columns of the contacts table (`-key` sorts descending). */
const SORT_COLUMNS = {
  email: contacts.email,
  name: sql`lower(coalesce(nullif(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}), ''), ${contacts.email}))`,
  status: contacts.status,
  createdAt: contacts.createdAt,
  lastOpenedAt: contacts.lastOpenedAt
} satisfies Record<string, AnyColumn | SQL>

export type ContactSortKey = keyof typeof SORT_COLUMNS

/** Only these keys can be null. `nulls last` elsewhere would keep the index from serving the order. */
const NULLABLE_SORT_KEYS: ReadonlySet<ContactSortKey> = new Set<ContactSortKey>(['lastOpenedAt'])

function isContactSortKey(key: string): key is ContactSortKey {
  return Object.hasOwn(SORT_COLUMNS, key)
}

/**
 * Translates the contacts list/export filters into SQL. Shared by the paginated
 * list, the CSV export and bulk actions so they always agree on "matching contacts".
 * Every condition is limited to the scope's organization.
 */
export class ContactFilter {
  constructor(
    private readonly scope: TenantScope,
    private readonly input: ContactFilterInput
  ) {}

  /** The organization's contacts matching the filters (never unscoped). */
  where(): SQL {
    const { q, status, listId, ids } = this.input
    const scoped = this.scope.eq(contacts.organizationId)

    return (
      and(
        scoped,
        q ? this.search(q) : undefined,
        status ? eq(contacts.status, status) : undefined,
        listId
          ? sql`exists (select 1 from ${listSubscriptions} where ${listSubscriptions.contactId} = ${contacts.id} and ${listSubscriptions.listId} = ${listId} and ${listSubscriptions.status} <> 'unsubscribed')`
          : undefined,
        ids?.length ? inArray(contacts.id, ids) : undefined
      ) ?? scoped
    )
  }

  /**
   * Matches email, first, last or full name. The expression mirrors the
   * `contacts_search_trgm_idx` trigram index so large tables avoid a seq scan.
   */
  private search(q: string): SQL {
    const pattern = containsPattern(q.trim())

    return sql`(${contacts.email} || ' ' || coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')) ilike ${pattern}`
  }

  /** `-createdAt` → newest first. Nulls always sort last; id breaks ties for stable pages. */
  static orderBy(sort: string): SQL[] {
    const descending = sort.startsWith('-')
    const requested = descending ? sort.slice(1) : sort
    const key: ContactSortKey = isContactSortKey(requested) ? requested : 'createdAt'
    const column = SORT_COLUMNS[key]

    const direction = descending ? sql`desc` : sql`asc`
    const nulls = NULLABLE_SORT_KEYS.has(key) ? sql` nulls last` : sql.empty()
    const primary = sql`${column} ${direction}${nulls}`

    return [primary, descending ? desc(contacts.id) : asc(contacts.id)]
  }
}
