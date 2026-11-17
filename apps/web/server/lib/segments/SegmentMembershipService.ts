import { and, asc, count, eq, gte, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { contacts, segmentMemberships, segments } from '../../db/schema'
import type { PaginationQuery } from '../../../shared/schemas/pagination'
import type { ContactSegment, ContactSegmentMembership } from '../../../shared/types/contacts'
import type { Paginated } from '../../../shared/types/domain'
import type {
  ContactSegmentEntry,
  SegmentMembershipChange,
  SegmentMembershipChangeKind,
  SegmentMembershipContact,
  SegmentMembershipStats
} from '../../../shared/types/segments'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import { NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import type { TenantScope } from '../core/TenantScope'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import { SegmentGraph } from './SegmentGraph'
import type { SegmentQueryBuilder } from './SegmentQueryBuilder'

export interface SegmentSyncResult {
  segmentId: string
  entered: number
  exited: number
  members: number
  baseline: boolean
}

export interface SegmentSyncOptions {
  periodic?: boolean
}

type ChangedContactRow = {
  id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  at: string
}

type CountRow = {
  total: number
}

type LockRow = {
  locked: boolean
}

type HistoryRow = ChangedContactRow & {
  membership_id: string
  change: SegmentMembershipChangeKind
}

const MAX_STATS_DAYS = 365

export const PERIODIC_SYNC_MIN_AGE_SECONDS = 240

const ISO_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'

const CHANGE_EVENTS = {
  entered: 'segment.entered',
  exited: 'segment.exited'
} as const satisfies Record<SegmentMembershipChangeKind, WebhookEventType>

export class SegmentMembershipService {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly builder: SegmentQueryBuilder,
    protected readonly webhooks: WebhookDispatcher
  ) {}

  async segmentIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: segments.id })
      .from(segments)
      .where(this.scope.eq(segments.organizationId))
      .orderBy(asc(segments.createdAt), asc(segments.id))

    return rows.map((row) => row.id)
  }

  async sync(segmentId: string, options: SegmentSyncOptions = {}): Promise<SegmentSyncResult> {
    const periodic = options.periodic ?? false
    const skipped = { segmentId, entered: 0, exited: 0, members: 0, baseline: false }

    const result = await this.db.transaction(async (tx) => {
      const locked = await this.lock(tx, segmentId, periodic)

      const [segment] = await tx
        .select({
          id: segments.id,
          name: segments.name,
          rules: segments.rules,
          syncedAt: segments.membershipSyncedAt,
          fresh: sql<boolean>`coalesce(${segments.membershipSyncedAt} > now() - make_interval(secs => ${PERIODIC_SYNC_MIN_AGE_SECONDS}), false)`
        })
        .from(segments)
        .where(this.segmentById(segmentId))

      if (!segment) throw new NotFoundError('Segment', segmentId)

      if (!locked || (periodic && segment.fresh)) return skipped

      const [filter] = await this.builder.buildMany([segment.rules])

      if (!filter) {
        console.error(`[segments] skipped the membership sync of segment ${segment.id}`)

        return skipped
      }

      const baseline = segment.syncedAt === null
      const exited = await this.count(tx, this.exitQuery(segment.id, filter))
      const entered = await this.count(tx, this.enterQuery(segment.id, filter, baseline))

      if (!baseline) {
        await this.notify(tx, 'exited', sql`sm.segment_id = ${segment.id}::uuid`)
        await this.notify(tx, 'entered', sql`sm.segment_id = ${segment.id}::uuid`)
      }

      const [open] = await tx
        .select({ value: count() })
        .from(segmentMemberships)
        .where(and(this.membershipsOf(segment.id), isNull(segmentMemberships.exitedAt)))

      const members = open?.value ?? 0

      await tx
        .update(segments)
        .set({
          membershipSyncedAt: sql`now()`,
          memberCount: members,
          updatedAt: sql`${segments.updatedAt}`
        })
        .where(this.segmentById(segment.id))

      return { segmentId: segment.id, entered, exited, members, baseline }
    })

    await this.webhooks.wake()

    return result
  }

  async syncWithDependents(segmentId: string): Promise<SegmentSyncResult[]> {
    const result = await this.sync(segmentId)

    if (!SegmentMembershipService.changed(result)) return [result]

    const results = [result]

    for (const id of await this.dependentIds(segmentId)) {
      const dependent = await this.syncExisting(id)

      if (dependent) results.push(dependent)
    }

    return results
  }

  async dependentIds(segmentId: string): Promise<string[]> {
    const graph = await SegmentGraph.load(this.db, this.scope)

    return graph.dependents(segmentId).map((node) => node.id)
  }

  async exitContacts(tx: Executor, contactIds: readonly string[]): Promise<void> {
    if (!contactIds.length) return

    const ids = sql`any(${sql.param(contactIds)}::uuid[])`

    await tx.execute(sql`select pg_advisory_xact_lock(${this.organizationKey()})`)
    await tx.execute(sql`
      with exited as (
        update ${segmentMemberships} sm set exited_at = now()
        where ${this.scope.sql('sm')} and sm.contact_id = ${ids} and sm.exited_at is null
        returning sm.segment_id
      ), counted as (
        select segment_id, count(*)::int as total from exited group by segment_id
      )
      update ${segments} s set member_count = greatest(s.member_count - counted.total, 0)
      from counted
      where s.id = counted.segment_id and s.member_count is not null`)

    await this.notify(tx, 'exited', sql`sm.contact_id = ${ids}`)
  }

  async syncAll(): Promise<SegmentSyncResult[]> {
    const results: SegmentSyncResult[] = []

    for (const id of await this.segmentIds()) results.push(await this.sync(id, { periodic: true }))

    return results
  }

  async stats(segmentId: string, days = 7): Promise<SegmentMembershipStats> {
    const segment = await this.findOrFail(segmentId)
    const window = Math.min(Math.max(Math.trunc(days), 1), MAX_STATS_DAYS)
    const since = sql`now() - make_interval(days => ${window}::int)`

    const [row] = await this.db
      .select({
        entered:
          sql<number>`count(*) filter (where ${segmentMemberships.enteredAt} >= ${since} and not ${segmentMemberships.baseline})`.mapWith(
            Number
          ),
        exited:
          sql<number>`count(*) filter (where ${segmentMemberships.exitedAt} >= ${since})`.mapWith(
            Number
          )
      })
      .from(segmentMemberships)
      .where(
        and(
          this.membershipsOf(segment.id),
          or(gte(segmentMemberships.enteredAt, since), gte(segmentMemberships.exitedAt, since))
        )
      )

    return {
      members: segment.memberCount,
      enteredRecently: row?.entered ?? 0,
      exitedRecently: row?.exited ?? 0,
      syncedAt: segment.membershipSyncedAt
    }
  }

  async history(
    segmentId: string,
    query: Pick<PaginationQuery, 'page' | 'pageSize'>
  ): Promise<Paginated<SegmentMembershipChange>> {
    const segment = await this.findOrFail(segmentId)
    const page = Page.from(query)
    const scoped = sql`${this.scope.sql('sm')} and sm.segment_id = ${segment.id}::uuid`

    const [rows, [total]] = await Promise.all([
      this.db.execute<HistoryRow>(sql`
        select h.membership_id, h.change, to_char(h.at at time zone 'UTC', ${ISO_FORMAT}) as at,
          c.id, c.email, c.first_name, c.last_name
        from (
          select sm.id as membership_id, 'entered' as change, sm.entered_at as at, sm.contact_id
          from ${segmentMemberships} sm
          where ${scoped} and not sm.baseline
          union all
          select sm.id, 'exited', sm.exited_at, sm.contact_id
          from ${segmentMemberships} sm
          where ${scoped} and sm.exited_at is not null
        ) h
        left join ${contacts} c on c.id = h.contact_id
        order by h.at desc, h.membership_id desc, h.change desc
        limit ${page.limit} offset ${page.offset}`),
      this.db
        .select({
          value:
            sql<number>`count(*) filter (where not ${segmentMemberships.baseline}) + count(${segmentMemberships.exitedAt})`.mapWith(
              Number
            )
        })
        .from(segmentMemberships)
        .where(this.membershipsOf(segment.id))
    ])

    const items = rows.rows.map((row) => ({
      id: `${row.membership_id}:${row.change}`,
      change: row.change,
      at: row.at,
      contact: SegmentMembershipService.contactOf(row)
    }))

    return page.wrap(items, total?.value ?? 0)
  }

  async contactHistory(contactId: string): Promise<ContactSegmentEntry[]> {
    return this.db
      .select({ segmentId: segmentMemberships.segmentId, enteredAt: segmentMemberships.enteredAt })
      .from(segmentMemberships)
      .where(
        and(
          this.scope.eq(segmentMemberships.organizationId),
          eq(segmentMemberships.contactId, contactId),
          isNull(segmentMemberships.exitedAt),
          eq(segmentMemberships.baseline, false)
        )
      )
  }

  async memberSince(
    contactId: string,
    memberships: readonly ContactSegment[]
  ): Promise<ContactSegmentMembership[]> {
    const entries = await this.contactHistory(contactId)

    const since = new Map(
      entries.map((entry) => [entry.segmentId, new Date(entry.enteredAt).toISOString()])
    )

    return memberships.map((membership) => ({
      ...membership,
      memberSince: since.get(membership.id) ?? null
    }))
  }

  private async lock(tx: Executor, segmentId: string, periodic: boolean): Promise<boolean> {
    const key = sql`hashtextextended(${`segment-membership:${segmentId}`}, 0)`

    await tx.execute(sql`select pg_advisory_xact_lock_shared(${this.organizationKey()})`)

    if (!periodic) {
      await tx.execute(sql`select pg_advisory_xact_lock(${key})`)

      return true
    }

    const result = await tx.execute<LockRow>(
      sql`select pg_try_advisory_xact_lock(${key}) as locked`
    )

    return result.rows[0]?.locked ?? false
  }

  private organizationKey(): SQL {
    return sql`hashtextextended(${`segment-membership-organization:${this.scope.organizationId}`}, 0)`
  }

  private async count(tx: Executor, change: SQL): Promise<number> {
    const result = await tx.execute<CountRow>(
      sql`with changed as (${change}) select count(*)::int as total from changed`
    )

    return result.rows[0]?.total ?? 0
  }

  private exitQuery(segmentId: string, filter: SQL): SQL {
    return sql`
      update ${segmentMemberships} sm set exited_at = now()
      where ${this.scope.sql('sm')} and sm.segment_id = ${segmentId}::uuid and sm.exited_at is null
        and not exists (select 1 from ${contacts} where ${contacts.id} = sm.contact_id and ${filter})
      returning sm.contact_id`
  }

  private enterQuery(segmentId: string, filter: SQL, baseline: boolean): SQL {
    return sql`
      insert into ${segmentMemberships} (organization_id, segment_id, contact_id, baseline)
      select ${this.scope.id}, ${segmentId}::uuid, ${contacts.id}, ${baseline}
      from ${contacts}
      where ${filter}
        and not exists (
          select 1 from ${segmentMemberships} sm
          where sm.segment_id = ${segmentId}::uuid and sm.contact_id = ${contacts.id} and sm.exited_at is null
        )
      on conflict (segment_id, contact_id) where exited_at is null do nothing
      returning contact_id`
  }

  private async notify(
    tx: Executor,
    change: SegmentMembershipChangeKind,
    where: SQL
  ): Promise<void> {
    const at = change === 'entered' ? sql`sm.entered_at` : sql`sm.exited_at`

    await this.webhooks.enqueue(
      tx,
      CHANGE_EVENTS[change],
      sql`
        select jsonb_build_object(
          'segment', jsonb_build_object('id', s.id, 'name', s.name),
          'contact', jsonb_build_object(
            'id', c.id, 'email', c.email, 'firstName', c.first_name, 'lastName', c.last_name
          ),
          ${`${change}At`}::text, to_char(${at} at time zone 'UTC', ${ISO_FORMAT})
        ) as data
        from ${segmentMemberships} sm
        join ${segments} s on s.id = sm.segment_id
        join ${contacts} c on c.id = sm.contact_id
        where ${this.scope.sql('sm')} and ${where} and ${at} = now()`
    )
  }

  private async syncExisting(segmentId: string): Promise<SegmentSyncResult | null> {
    try {
      return await this.sync(segmentId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  }

  private static changed(result: SegmentSyncResult): boolean {
    return result.entered + result.exited > 0
  }

  private static contactOf(row: ChangedContactRow): SegmentMembershipContact | null {
    if (!row.id || !row.email) return null

    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name
    }
  }

  private async findOrFail(id: string) {
    const [row] = await this.db.select().from(segments).where(this.segmentById(id))

    if (!row) throw new NotFoundError('Segment', id)

    return row
  }

  private segmentById(id: string) {
    return and(this.scope.eq(segments.organizationId), eq(segments.id, id))
  }

  private membershipsOf(segmentId: string) {
    return and(
      this.scope.eq(segmentMemberships.organizationId),
      eq(segmentMemberships.segmentId, segmentId)
    )
  }
}
