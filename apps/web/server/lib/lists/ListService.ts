import { and, count, desc, eq, ilike, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, listSubscriptions, lists } from '../../db/schema'
import type { ListInput } from '../../../shared/schemas/lists'
import type { SubscriptionStatus } from '../../../shared/types/domain'
import type { Actor } from '../core/actor'
import { NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import { AuditLogger } from '../audit/AuditLogger'
import type { LimitService } from '../limits/LimitService'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export type ListRow = typeof lists.$inferSelect

export interface ListWithCounts extends ListRow {
  confirmedCount: number
  unconfirmedCount: number
  unsubscribedCount: number
}

export interface ListMembersQuery {
  page: number
  pageSize: number
  q?: string
  status?: SubscriptionStatus
}

/**
 * The organization's static mailing lists (membership managed through
 * ContactService). Another organization's list ids behave as not found.
 */
export class ListService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly audit: AuditLogger,
    private readonly limits: LimitService
  ) {}

  private countsQuery(where?: SQL) {
    return this.db
      .select({
        list: lists,
        confirmedCount: sql<number>`count(*) filter (where ${listSubscriptions.status} = 'confirmed')::int`,
        unconfirmedCount: sql<number>`count(*) filter (where ${listSubscriptions.status} = 'unconfirmed')::int`,
        unsubscribedCount: sql<number>`count(*) filter (where ${listSubscriptions.status} = 'unsubscribed')::int`
      })
      .from(lists)
      .leftJoin(listSubscriptions, eq(listSubscriptions.listId, lists.id))
      .where(and(this.scope.eq(lists.organizationId), where))
      .groupBy(lists.id)
  }

  private byId(id: string): SQL | undefined {
    return and(this.scope.eq(lists.organizationId), eq(lists.id, id))
  }

  async list(): Promise<ListWithCounts[]> {
    const rows = await this.countsQuery().orderBy(desc(lists.createdAt))

    return rows.map(({ list, ...counts }) => Object.assign(list, counts))
  }

  async get(id: string): Promise<ListWithCounts> {
    const [row] = await this.countsQuery(eq(lists.id, id))

    if (!row) throw new NotFoundError('List', id)
    const { list, ...counts } = row

    return { ...list, ...counts }
  }

  async findOrFail(id: string): Promise<ListRow> {
    const [row] = await this.db.select().from(lists).where(this.byId(id))

    if (!row) throw new NotFoundError('List', id)

    return row
  }

  async create(input: ListInput, actor: Actor): Promise<ListRow> {
    await this.limits.assertCanCreate('lists')
    const [row] = await this.db.insert(lists).values(this.scope.values(input)).returning()
    await this.audit.log(actor, {
      action: 'list.created',
      entityType: 'list',
      entityId: row!.id,
      summary: `Created list "${row!.name}"`
    })

    return row!
  }

  async update(id: string, input: Partial<ListInput>, actor: Actor): Promise<ListRow> {
    const before = await this.findOrFail(id)
    const [row] = await this.db.update(lists).set(input).where(this.byId(id)).returning()
    await this.audit.log(actor, {
      action: 'list.updated',
      entityType: 'list',
      entityId: id,
      summary: `Updated list "${row!.name}"`,
      changes: AuditLogger.diff(before, row!)
    })

    return row!
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const list = await this.findOrFail(id)
    await this.db.delete(lists).where(this.byId(id))
    await this.audit.log(actor, {
      action: 'list.deleted',
      entityType: 'list',
      entityId: id,
      summary: `Deleted list "${list.name}"`
    })
  }

  async members(listId: string, query: ListMembersQuery) {
    await this.findOrFail(listId)
    const page = Page.from(query)

    const membership = and(
      eq(listSubscriptions.listId, listId),
      query.status ? eq(listSubscriptions.status, query.status) : undefined
    )

    const where = and(
      this.scope.eq(contacts.organizationId),
      membership,
      query.q ? ilike(contacts.email, containsPattern(query.q.toLowerCase())) : undefined
    )

    // The list is this organization's (checked above), and so are its members: without a
    // search the total is read from the subscriptions index alone.
    const total = query.q
      ? this.db
          .select({ value: count() })
          .from(listSubscriptions)
          .innerJoin(contacts, eq(contacts.id, listSubscriptions.contactId))
          .where(where)
      : this.db.select({ value: count() }).from(listSubscriptions).where(membership)

    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          contactStatus: contacts.status,
          status: listSubscriptions.status,
          subscribedAt: listSubscriptions.createdAt,
          confirmedAt: listSubscriptions.confirmedAt
        })
        .from(listSubscriptions)
        .innerJoin(contacts, eq(contacts.id, listSubscriptions.contactId))
        .where(where)
        // Contact id breaks ties (a bulk add shares one timestamp), so pages never overlap.
        .orderBy(desc(listSubscriptions.createdAt), desc(listSubscriptions.contactId))
        .limit(page.limit)
        .offset(page.offset),
      total
    ])

    return page.wrap(items, counted?.value ?? 0)
  }
}
