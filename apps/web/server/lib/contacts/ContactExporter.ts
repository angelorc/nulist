import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import Papa from 'papaparse'
import type { Database } from '../../db/client'
import { contacts, listSubscriptions, lists } from '../../db/schema'
import { formatAttributeValue } from '../../../shared/schemas/contacts'
import type { TenantScope } from '../core/TenantScope'
import { ContactFilter } from './ContactFilter'
import type { ContactFilterInput } from './ContactFilter'

const BATCH_SIZE = 2000
const MAX_ATTRIBUTE_COLUMNS = 200

const BASE_FIELDS = [
  'email',
  'first_name',
  'last_name',
  'status',
  'source',
  'lists',
  'created_at',
  'last_opened_at',
  'last_clicked_at'
] as const

function iso(value: Date | null): string {
  return value ? value.toISOString() : ''
}

/**
 * Streams the organization's matching contacts as CSV in keyset-paginated
 * batches so exports of any size run in constant memory. Every attribute key
 * becomes a column. Formula-like cells are escaped (CSV injection).
 */
export class ContactExporter {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  private filter(input: ContactFilterInput): ContactFilter {
    return new ContactFilter(this.scope, input)
  }

  async count(input: ContactFilterInput): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(contacts)
      .where(this.filter(input).where())

    return row?.value ?? 0
  }

  private async attributeKeys(input: ContactFilterInput): Promise<string[]> {
    const rows = await this.db.execute<{ key: string }>(sql`
      select distinct jsonb_object_keys(${contacts.attributes}) as key
      from ${contacts}
      where ${this.filter(input).where()}
      order by key
      limit ${MAX_ATTRIBUTE_COLUMNS}
    `)

    return rows.rows.map((r) => r.key)
  }

  private async listNames(contactIds: string[]): Promise<Map<string, string>> {
    if (!contactIds.length) return new Map()

    const rows = await this.db
      .select({
        contactId: listSubscriptions.contactId,
        names: sql<string>`string_agg(${lists.name}, '; ' order by ${lists.name})`
      })
      .from(listSubscriptions)
      .innerJoin(lists, eq(lists.id, listSubscriptions.listId))
      .where(
        and(
          this.scope.eq(lists.organizationId),
          inArray(listSubscriptions.contactId, contactIds),
          eq(listSubscriptions.status, 'confirmed')
        )
      )
      .groupBy(listSubscriptions.contactId)

    return new Map(rows.map((r) => [r.contactId, r.names]))
  }

  async *stream(input: ContactFilterInput): AsyncGenerator<string> {
    const keys = await this.attributeKeys(input)
    const fields = [...BASE_FIELDS, ...keys.map((k) => `attribute.${k}`)]
    const where = this.filter(input).where()
    let cursor: string | null = null
    let first = true

    while (true) {
      const batch = await this.db
        .select()
        .from(contacts)
        .where(and(where, cursor ? gt(contacts.id, cursor) : undefined))
        .orderBy(asc(contacts.id))
        .limit(BATCH_SIZE)

      if (!batch.length && !first) return

      const names = await this.listNames(batch.map((c) => c.id))

      const data = batch.map((c) => [
        c.email,
        c.firstName ?? '',
        c.lastName ?? '',
        c.status,
        c.source ?? '',
        names.get(c.id) ?? '',
        iso(c.createdAt),
        iso(c.lastOpenedAt),
        iso(c.lastClickedAt),
        ...keys.map((k) => formatAttributeValue(c.attributes[k]))
      ])

      yield (
        Papa.unparse({ fields, data }, { header: first, escapeFormulae: true, newline: '\r\n' }) +
          '\r\n'
      )
      first = false

      if (batch.length < BATCH_SIZE) return
      cursor = batch[batch.length - 1]!.id
    }
  }
}
