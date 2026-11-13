import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  max,
  notInArray,
  or,
  sql
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  apiLogs,
  apikey,
  auditLogs,
  broadcasts,
  contacts,
  emailEvents,
  inboundEvents,
  messages,
  templates
} from '../../db/schema'
import type { Paginated } from '../../../shared/types/domain'
import type {
  ApiFacetKey,
  ApiLogDetail,
  ApiLogFacets,
  ApiLogItem,
  ApiLogStats,
  AuditLogItem,
  EmailEngagement,
  EmailEventItem,
  EmailFacetKey,
  EmailLogDetail,
  EmailLogFacets,
  EmailLogItem,
  EmailLogStats,
  EmailOutcome,
  InboundEventDetail,
  InboundEventFacets,
  InboundEventItem,
  InboundEventStats,
  InboundFacetKey,
  InboundStatus,
  StatusClass
} from '../../../shared/types/logs'
import { NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import {
  EMAIL_OUTCOME_STATUSES,
  EMAIL_OUTCOMES,
  recordedBodySchema
} from '../../../shared/schemas/logs'
import type { ApiLogQuery, EmailLogQuery, InboundEventQuery } from '../../../shared/schemas/logs'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'
import { FacetCounter } from './FacetCounter'
import { LogWindow } from './LogWindow'
import { SesEventSummary } from './SesEventSummary'

const STATUS_CLASS_RANGE = { '2xx': 200, '3xx': 300, '4xx': 400, '5xx': 500 } as const

const ISSUE_STATUSES = EMAIL_OUTCOME_STATUSES.issues
const OK_STATUSES = EMAIL_OUTCOME_STATUSES.delivered

const STATUS_OUTCOME = new Map(
  EMAIL_OUTCOMES.flatMap((outcome) =>
    EMAIL_OUTCOME_STATUSES[outcome].map((status): [string, EmailOutcome] => [status, outcome])
  )
)

const HIGH_CARDINALITY_LIMIT = 20

const ENGAGEMENT = sql<EmailEngagement>`case when ${messages.clickCount} > 0 then 'clicked' when ${messages.openCount} > 0 then 'opened' else 'none' end`

const STATUS_CLASS = sql<StatusClass>`(${apiLogs.statusCode} / 100)::text || 'xx'`

const INBOUND_TYPE = sql<string>`coalesce(${inboundEvents.eventType}, ${inboundEvents.type})`

const INBOUND_MESSAGE = sql<string>`coalesce(${inboundEvents.payload}->>'Message', ${inboundEvents.payload}::text)`

function tally(condition: SQL): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number)
}

function iso(date: Date): string
function iso(date: Date | null): string | null
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

/**
 * Read side of one organization's observability: email message logs with their
 * provider events, inbound provider notifications, API request logs and audit
 * entries. Rows of other organizations, and instance-level rows without an
 * organization (uncorrelated SNS notifications, unauthenticated API calls,
 * organization management), are never returned: lookups by id are "not found".
 */
export class LogService {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    private readonly sesSummary = new SesEventSummary()
  ) {}

  // Emails ------------------------------------------------------------------
  private emailFilters(query: EmailLogQuery): SQL | undefined {
    const m = messages
    const { from, to } = LogWindow.bounds(query)

    return and(
      this.scope.eq(m.organizationId),
      query.q
        ? or(ilike(m.toEmail, containsPattern(query.q)), ilike(m.subject, containsPattern(query.q)))
        : undefined,
      query.status ? inArray(m.status, query.status) : undefined,
      query.outcome ? inArray(m.status, [...EMAIL_OUTCOME_STATUSES[query.outcome]]) : undefined,
      query.kind ? inArray(m.kind, query.kind) : undefined,
      query.engagement ? inArray(ENGAGEMENT, query.engagement) : undefined,
      query.broadcastId ? inArray(m.broadcastId, query.broadcastId) : undefined,
      query.contactId ? eq(m.contactId, query.contactId) : undefined,
      query.templateId ? eq(m.templateId, query.templateId) : undefined,
      query.recipient ? sql`lower(${m.toEmail}) = lower(${query.recipient})` : undefined,
      from ? gte(m.createdAt, from) : undefined,
      to ? lt(m.createdAt, to) : undefined
    )
  }

  async emails(query: EmailLogQuery): Promise<Paginated<EmailLogItem>> {
    const page = Page.from(query)
    const where = this.emailFilters(query)
    const m = messages

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: m.id,
          kind: m.kind,
          status: m.status,
          toEmail: m.toEmail,
          subject: m.subject,
          broadcastId: m.broadcastId,
          broadcastName: broadcasts.name,
          openCount: m.openCount,
          clickCount: m.clickCount,
          error: m.error,
          createdAt: m.createdAt,
          sentAt: m.sentAt
        })
        .from(m)
        .leftJoin(broadcasts, eq(broadcasts.id, m.broadcastId))
        .where(where)
        .orderBy(desc(m.createdAt), desc(m.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(m).where(where)
    ])

    const items = rows.map(
      ({ broadcastId, broadcastName, createdAt, sentAt, ...row }): EmailLogItem => ({
        ...row,
        broadcast: broadcastId
          ? { id: broadcastId, name: broadcastName ?? 'Deleted broadcast' }
          : null,
        createdAt: iso(createdAt),
        sentAt: iso(sentAt)
      })
    )

    return page.wrap(items, total?.value ?? 0)
  }

  async emailStats(query: EmailLogQuery): Promise<EmailLogStats> {
    const m = messages
    const window = LogWindow.of(query)
    const scoped = this.emailFilters({ ...query, status: undefined, outcome: undefined })
    const bucket = window.bucketKey(m.createdAt)

    const [byStatus, volume, [last]] = await Promise.all([
      this.db.select({ status: m.status, value: count() }).from(m).where(scoped).groupBy(m.status),
      this.db
        .select({
          at: bucket,
          ok: tally(inArray(m.status, [...OK_STATUSES])),
          issues: tally(inArray(m.status, [...ISSUE_STATUSES])),
          other: tally(notInArray(m.status, [...OK_STATUSES, ...ISSUE_STATUSES]))
        })
        .from(m)
        .where(and(scoped, window.within(m.createdAt)))
        .groupBy(sql`1`),
      this.db
        .select({ value: max(m.createdAt) })
        .from(m)
        .where(this.scope.eq(m.organizationId))
    ])

    const facets: Record<EmailOutcome, number> = {
      delivered: 0,
      in_flight: 0,
      issues: 0,
      skipped: 0
    }

    for (const row of byStatus) {
      const outcome = STATUS_OUTCOME.get(row.status)

      if (outcome) facets[outcome] += row.value
    }

    return {
      total: byStatus.reduce((sum, row) => sum + row.value, 0),
      facets,
      volume: window.fill(volume),
      bucket: window.bucket,
      window: window.range,
      lastAt: last?.value ? iso(last.value) : null
    }
  }

  async emailFacets(query: EmailLogQuery): Promise<EmailLogFacets> {
    const m = messages

    const facets = new FacetCounter<EmailFacetKey>(
      this.db,
      m,
      (key) => this.emailFilters({ ...query, [key]: undefined }),
      query
    )

    const [status, kind, engagement, broadcastId, [contact], [template]] = await Promise.all([
      facets.count('status', { value: m.status }),
      facets.count('kind', { value: m.kind }),
      facets.count('engagement', { value: ENGAGEMENT }),
      facets.count('broadcastId', {
        value: m.broadcastId,
        label: {
          table: broadcasts,
          on: eq(broadcasts.id, m.broadcastId),
          name: broadcasts.name,
          id: broadcasts.id,
          scope: this.scope.eq(broadcasts.organizationId)
        },
        limit: HIGH_CARDINALITY_LIMIT
      }),
      query.contactId
        ? this.db
            .select({ id: contacts.id, email: contacts.email })
            .from(contacts)
            .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, query.contactId)))
        : [],
      query.templateId
        ? this.db
            .select({ id: templates.id, name: templates.name })
            .from(templates)
            .where(and(this.scope.eq(templates.organizationId), eq(templates.id, query.templateId)))
        : []
    ])

    return {
      facets: { status, kind, engagement, broadcastId },
      scope: { contact: contact ?? null, template: template ?? null }
    }
  }

  async message(id: string): Promise<EmailLogDetail> {
    const [row] = await this.db
      .select({
        message: messages,
        broadcastName: broadcasts.name,
        broadcastHtml: broadcasts.htmlSnapshot,
        contact: {
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          attributes: contacts.attributes
        },
        templateName: templates.name
      })
      .from(messages)
      .leftJoin(broadcasts, eq(broadcasts.id, messages.broadcastId))
      .leftJoin(contacts, eq(contacts.id, messages.contactId))
      .leftJoin(templates, eq(templates.id, messages.templateId))
      .where(and(this.scope.eq(messages.organizationId), eq(messages.id, id)))

    if (!row) throw new NotFoundError('Email', id)

    const events = await this.db
      .select({
        id: emailEvents.id,
        type: emailEvents.type,
        occurredAt: emailEvents.occurredAt,
        data: emailEvents.data
      })
      .from(emailEvents)
      .where(and(this.scope.eq(emailEvents.organizationId), eq(emailEvents.messageId, id)))
      .orderBy(asc(emailEvents.occurredAt), asc(emailEvents.id))

    const m = row.message
    const html = m.html ?? row.broadcastHtml ?? null

    return {
      id: m.id,
      kind: m.kind,
      status: m.status,
      toEmail: m.toEmail,
      fromEmail: m.fromEmail,
      replyTo: m.replyTo,
      subject: m.subject,
      broadcast: m.broadcastId
        ? { id: m.broadcastId, name: row.broadcastName ?? 'Deleted broadcast' }
        : null,
      openCount: m.openCount,
      clickCount: m.clickCount,
      error: m.error,
      html,
      htmlSource: m.html ? 'message' : html ? 'broadcast' : null,
      text: m.text,
      tags: m.tags,
      variables: m.variables,
      providerMessageId: m.providerMessageId,
      idempotencyKey: m.idempotencyKey,
      runId: m.runId,
      apiKeyId: m.apiKeyId,
      createdAt: iso(m.createdAt),
      updatedAt: iso(m.updatedAt),
      scheduledAt: iso(m.scheduledAt),
      sentAt: iso(m.sentAt),
      deliveredAt: iso(m.deliveredAt),
      openedAt: iso(m.openedAt),
      clickedAt: iso(m.clickedAt),
      contact: row.contact,
      template:
        m.templateId && row.templateName ? { id: m.templateId, name: row.templateName } : null,
      events: events.map((e): EmailEventItem => ({
        id: e.id,
        type: e.type,
        occurredAt: iso(e.occurredAt),
        data: e.data
      }))
    }
  }

  // Inbound provider events -------------------------------------------------
  private inboundFilters(query: InboundEventQuery): SQL | undefined {
    const ie = inboundEvents
    const { from, to } = LogWindow.bounds(query)

    return and(
      this.scope.eq(ie.organizationId),
      query.q
        ? or(
            ilike(ie.snsMessageId, containsPattern(query.q)),
            ilike(ie.eventType, containsPattern(query.q)),
            ilike(ie.type, containsPattern(query.q)),
            ilike(sql`${ie.payload}::text`, containsPattern(query.q))
          )
        : undefined,
      query.status ? inArray(ie.status, query.status) : undefined,
      query.eventType ? inArray(ie.eventType, query.eventType) : undefined,
      query.recipient ? ilike(INBOUND_MESSAGE, containsPattern(`"${query.recipient}"`)) : undefined,
      from ? gte(ie.createdAt, from) : undefined,
      to ? lt(ie.createdAt, to) : undefined
    )
  }

  private async describeInbound<T extends { message: string | null; createdAt: Date }>(
    rows: T[]
  ): Promise<
    (Omit<T, 'message' | 'createdAt'> &
      Pick<InboundEventItem, 'createdAt' | 'recipient' | 'detail' | 'message'>)[]
  > {
    const facts = rows.map((row) => this.sesSummary.read(row.message))
    const ids = [...new Set(facts.flatMap((f) => (f.messageId ? [f.messageId] : [])))]

    const subjects = ids.length
      ? await this.db
          .select({ id: messages.id, subject: messages.subject })
          .from(messages)
          .where(and(this.scope.eq(messages.organizationId), inArray(messages.id, ids)))
      : []

    const byId = new Map(subjects.map((m) => [m.id, m]))

    return rows.map(({ message: _message, createdAt, ...row }, i) => {
      const fact = facts[i]
      const linked = fact?.messageId ? byId.get(fact.messageId) : undefined

      return {
        ...row,
        createdAt: iso(createdAt),
        recipient: fact?.recipient ?? null,
        detail: fact?.detail ?? null,
        message: linked ? { id: linked.id, subject: linked.subject } : null
      }
    })
  }

  async inboundEvents(query: InboundEventQuery): Promise<Paginated<InboundEventItem>> {
    const page = Page.from(query)
    const ie = inboundEvents
    const where = this.inboundFilters(query)

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: ie.id,
          snsMessageId: ie.snsMessageId,
          type: ie.type,
          eventType: ie.eventType,
          topicArn: ie.topicArn,
          status: ie.status,
          error: ie.error,
          createdAt: ie.createdAt,
          message: sql<string>`coalesce(${ie.payload}->>'Message', ${ie.payload}::text)`
        })
        .from(ie)
        .where(where)
        .orderBy(desc(ie.createdAt), desc(ie.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(ie).where(where)
    ])

    return page.wrap(await this.describeInbound(rows), total?.value ?? 0)
  }

  async inboundEvent(id: string): Promise<InboundEventDetail> {
    const [row] = await this.db
      .select({
        id: inboundEvents.id,
        snsMessageId: inboundEvents.snsMessageId,
        type: inboundEvents.type,
        eventType: inboundEvents.eventType,
        topicArn: inboundEvents.topicArn,
        status: inboundEvents.status,
        error: inboundEvents.error,
        createdAt: inboundEvents.createdAt,
        payload: inboundEvents.payload,
        message: sql<string>`coalesce(${inboundEvents.payload}->>'Message', ${inboundEvents.payload}::text)`
      })
      .from(inboundEvents)
      .where(and(this.scope.eq(inboundEvents.organizationId), eq(inboundEvents.id, id)))

    if (!row) throw new NotFoundError('Event', id)
    const [described] = await this.describeInbound([row])

    if (!described) throw new NotFoundError('Event', id)

    return described
  }

  async inboundStats(query: InboundEventQuery): Promise<InboundEventStats> {
    const ie = inboundEvents
    const window = LogWindow.of(query)
    const scoped = this.inboundFilters({ ...query, status: undefined, eventType: undefined })
    const bucket = window.bucketKey(ie.createdAt)

    const [byStatus, types, volume, [last]] = await Promise.all([
      this.db
        .select({ status: ie.status, value: count() })
        .from(ie)
        .where(scoped)
        .groupBy(ie.status),
      this.db
        .select({ type: INBOUND_TYPE, value: count() })
        .from(ie)
        .where(scoped)
        .groupBy(sql`1`)
        .orderBy(desc(count())),
      this.db
        .select({
          at: bucket,
          ok: tally(eq(ie.status, 'processed')),
          issues: tally(eq(ie.status, 'failed')),
          other: tally(eq(ie.status, 'ignored'))
        })
        .from(ie)
        .where(and(scoped, window.within(ie.createdAt)))
        .groupBy(sql`1`),
      this.db
        .select({ value: max(ie.createdAt) })
        .from(ie)
        .where(this.scope.eq(ie.organizationId))
    ])

    const facets: Record<InboundStatus, number> = { processed: 0, ignored: 0, failed: 0 }

    for (const row of byStatus) facets[row.status] = row.value

    return {
      total: byStatus.reduce((sum, row) => sum + row.value, 0),
      facets,
      types: types.map((row) => ({ type: row.type, count: row.value })),
      volume: window.fill(volume),
      bucket: window.bucket,
      window: window.range,
      lastAt: last?.value ? iso(last.value) : null
    }
  }

  async inboundFacets(query: InboundEventQuery): Promise<InboundEventFacets> {
    const ie = inboundEvents

    const facets = new FacetCounter<InboundFacetKey>(
      this.db,
      ie,
      (key) => this.inboundFilters({ ...query, [key]: undefined }),
      query
    )

    const [status, eventType] = await Promise.all([
      facets.count('status', { value: ie.status }),
      facets.count('eventType', { value: INBOUND_TYPE })
    ])

    return { facets: { status, eventType } }
  }

  // API requests ------------------------------------------------------------
  private apiLogSelect() {
    return {
      id: apiLogs.id,
      method: apiLogs.method,
      path: apiLogs.path,
      statusCode: apiLogs.statusCode,
      durationMs: apiLogs.durationMs,
      ip: apiLogs.ip,
      createdAt: apiLogs.createdAt,
      apiKeyId: apiLogs.apiKeyId,
      apiKeyName: apikey.name,
      apiKeyStart: apikey.start
    }
  }

  private static toApiLogItem(row: {
    id: number
    method: string
    path: string
    statusCode: number
    durationMs: number
    ip: string | null
    createdAt: Date
    apiKeyId: string | null
    apiKeyName: string | null
    apiKeyStart: string | null
  }): ApiLogItem {
    const { apiKeyId, apiKeyName, apiKeyStart, createdAt, ...rest } = row

    return {
      ...rest,
      apiKey: apiKeyId ? { id: apiKeyId, name: apiKeyName, start: apiKeyStart } : null,
      createdAt: iso(createdAt)
    }
  }

  private apiFilters(query: ApiLogQuery): SQL | undefined {
    const a = apiLogs
    const { from, to } = LogWindow.bounds(query)

    const statusClasses = query.status?.map((status) => {
      const floor = STATUS_CLASS_RANGE[status]

      return and(gte(a.statusCode, floor), lt(a.statusCode, floor + 100))
    })

    return and(
      this.scope.eq(a.organizationId),
      query.q ? ilike(a.path, containsPattern(query.q)) : undefined,
      query.method ? inArray(a.method, query.method) : undefined,
      statusClasses ? or(...statusClasses) : undefined,
      query.apiKeyId ? inArray(a.apiKeyId, query.apiKeyId) : undefined,
      from ? gte(a.createdAt, from) : undefined,
      to ? lt(a.createdAt, to) : undefined
    )
  }

  async apiLogs(query: ApiLogQuery): Promise<Paginated<ApiLogItem>> {
    const page = Page.from(query)
    const a = apiLogs
    const where = this.apiFilters(query)

    const [rows, [total]] = await Promise.all([
      this.db
        .select(this.apiLogSelect())
        .from(a)
        .leftJoin(apikey, eq(apikey.id, a.apiKeyId))
        .where(where)
        .orderBy(desc(a.createdAt), desc(a.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(a).where(where)
    ])

    return page.wrap(rows.map(LogService.toApiLogItem), total?.value ?? 0)
  }

  async apiLog(id: number): Promise<ApiLogDetail> {
    const [row] = await this.db
      .select({
        ...this.apiLogSelect(),
        userAgent: apiLogs.userAgent,
        requestBody: apiLogs.requestBody,
        responseBody: apiLogs.responseBody
      })
      .from(apiLogs)
      .leftJoin(apikey, eq(apikey.id, apiLogs.apiKeyId))
      .where(and(this.scope.eq(apiLogs.organizationId), eq(apiLogs.id, id)))

    if (!row) throw new NotFoundError('API request', String(id))
    const { userAgent, requestBody, responseBody, ...item } = row

    return {
      ...LogService.toApiLogItem(item),
      userAgent,
      requestBody: recordedBodySchema.parse(requestBody),
      responseBody: recordedBodySchema.parse(responseBody)
    }
  }

  async apiStats(query: ApiLogQuery): Promise<ApiLogStats> {
    const a = apiLogs
    const window = LogWindow.of(query)
    const scoped = this.apiFilters({ ...query, status: undefined })
    const bucket = window.bucketKey(a.createdAt)

    const [byClass, [latency], volume, [last]] = await Promise.all([
      this.db
        .select({ status: STATUS_CLASS, value: count() })
        .from(a)
        .where(scoped)
        .groupBy(sql`1`),
      this.db
        .select({
          p95: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${a.durationMs})::float8`
        })
        .from(a)
        .where(scoped),
      this.db
        .select({
          at: bucket,
          ok: tally(lt(a.statusCode, 400)),
          issues: tally(gte(a.statusCode, 400)),
          other: sql<number>`0`.mapWith(Number)
        })
        .from(a)
        .where(and(scoped, window.within(a.createdAt)))
        .groupBy(sql`1`),
      this.db
        .select({ value: max(a.createdAt) })
        .from(a)
        .where(this.scope.eq(a.organizationId))
    ])

    const facets: Record<StatusClass, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }

    for (const row of byClass) if (row.status in facets) facets[row.status] = row.value

    return {
      total: byClass.reduce((sum, row) => sum + row.value, 0),
      facets,
      p95Ms: latency?.p95 == null ? null : Math.round(latency.p95),
      volume: window.fill(volume),
      bucket: window.bucket,
      window: window.range,
      lastAt: last?.value ? iso(last.value) : null
    }
  }

  async apiFacets(query: ApiLogQuery): Promise<ApiLogFacets> {
    const a = apiLogs

    const facets = new FacetCounter<ApiFacetKey>(
      this.db,
      a,
      (key) => this.apiFilters({ ...query, [key]: undefined }),
      query
    )

    const [status, method, apiKeyId] = await Promise.all([
      facets.count('status', { value: STATUS_CLASS }),
      facets.count('method', { value: a.method }),
      facets.count('apiKeyId', {
        value: a.apiKeyId,
        label: {
          table: apikey,
          on: eq(apikey.id, a.apiKeyId),
          name: apikey.name,
          id: apikey.id,
          scope: this.scope.eq(apikey.referenceId)
        },
        limit: HIGH_CARDINALITY_LIMIT
      })
    ])

    return { facets: { status, method, apiKeyId } }
  }

  // Audit -------------------------------------------------------------------
  async auditEntry(id: number): Promise<AuditLogItem> {
    const [row] = await this.db
      .select()
      .from(auditLogs)
      .where(and(this.scope.eq(auditLogs.organizationId), eq(auditLogs.id, id)))

    if (!row) throw new NotFoundError('Audit entry', String(id))

    return { ...row, createdAt: iso(row.createdAt) }
  }

  /** Entity types present in the audit log (for filters). */
  async auditEntityTypes(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ entityType: auditLogs.entityType })
      .from(auditLogs)
      .where(this.scope.eq(auditLogs.organizationId))
      .orderBy(asc(auditLogs.entityType))

    return rows.map((r) => r.entityType)
  }
}
