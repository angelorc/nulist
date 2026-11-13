import { and, asc, count, desc, eq, gte, ilike, lt, lte, or } from 'drizzle-orm'
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
  ApiLogDetail,
  ApiLogItem,
  AuditLogItem,
  EmailEventItem,
  EmailLogDetail,
  EmailLogItem,
  InboundEventDetail,
  InboundEventItem,
  LogPeriod
} from '../../../shared/types/logs'
import { NotFoundError } from '../core/errors'
import { Page } from '../core/pagination'
import { recordedBodySchema } from '../../../shared/schemas/logs'
import type { ApiLogQuery, EmailLogQuery, InboundEventQuery } from '../../../shared/schemas/logs'
import { containsPattern } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

const PERIOD_MS: Record<LogPeriod, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000
}

const STATUS_CLASS_RANGE = { '2xx': 200, '3xx': 300, '4xx': 400, '5xx': 500 } as const

function since(period: LogPeriod | undefined, now = Date.now()): Date | undefined {
  return period ? new Date(now - PERIOD_MS[period]) : undefined
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
    protected readonly db: Database
  ) {}

  // Emails ------------------------------------------------------------------
  private emailFilters(query: EmailLogQuery): SQL | undefined {
    const m = messages
    const from = query.from ?? since(query.period)

    return and(
      this.scope.eq(m.organizationId),
      query.q
        ? or(ilike(m.toEmail, containsPattern(query.q)), ilike(m.subject, containsPattern(query.q)))
        : undefined,
      query.status ? eq(m.status, query.status) : undefined,
      query.kind ? eq(m.kind, query.kind) : undefined,
      query.broadcastId ? eq(m.broadcastId, query.broadcastId) : undefined,
      query.contactId ? eq(m.contactId, query.contactId) : undefined,
      from ? gte(m.createdAt, from) : undefined,
      query.to ? lte(m.createdAt, query.to) : undefined
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
  async inboundEvents(query: InboundEventQuery): Promise<Paginated<InboundEventItem>> {
    const page = Page.from(query)
    const ie = inboundEvents
    const from = since(query.period)

    const where = and(
      this.scope.eq(ie.organizationId),
      query.q
        ? or(
            ilike(ie.snsMessageId, containsPattern(query.q)),
            ilike(ie.eventType, containsPattern(query.q)),
            ilike(ie.type, containsPattern(query.q))
          )
        : undefined,
      query.status ? eq(ie.status, query.status) : undefined,
      query.eventType ? eq(ie.eventType, query.eventType) : undefined,
      from ? gte(ie.createdAt, from) : undefined
    )

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
          createdAt: ie.createdAt
        })
        .from(ie)
        .where(where)
        .orderBy(desc(ie.createdAt), desc(ie.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(ie).where(where)
    ])

    return page.wrap(
      rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
      total?.value ?? 0
    )
  }

  async inboundEvent(id: string): Promise<InboundEventDetail> {
    const [row] = await this.db
      .select()
      .from(inboundEvents)
      .where(and(this.scope.eq(inboundEvents.organizationId), eq(inboundEvents.id, id)))

    if (!row) throw new NotFoundError('Event', id)

    return { ...row, createdAt: iso(row.createdAt) }
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

  async apiLogs(query: ApiLogQuery): Promise<Paginated<ApiLogItem>> {
    const page = Page.from(query)
    const a = apiLogs
    const from = since(query.period)
    const statusFloor = query.status ? STATUS_CLASS_RANGE[query.status] : undefined

    const where = and(
      this.scope.eq(a.organizationId),
      query.q ? ilike(a.path, containsPattern(query.q)) : undefined,
      query.method ? eq(a.method, query.method) : undefined,
      statusFloor
        ? and(gte(a.statusCode, statusFloor), lt(a.statusCode, statusFloor + 100))
        : undefined,
      query.apiKeyId ? eq(a.apiKeyId, query.apiKeyId) : undefined,
      from ? gte(a.createdAt, from) : undefined
    )

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
