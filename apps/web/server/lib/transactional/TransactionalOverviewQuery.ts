import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { messages, templates } from '../../db/schema'
import type {
  StatusCounts,
  TransactionalRecentEmail,
  TransactionalTemplateItem,
  TransactionalWindow
} from '../../../shared/schemas/transactional'
import type { MessageStatus } from '../../../shared/types/domain'
import type { TenantScope } from '../core/TenantScope'

/** Statuses of messages the provider accepted. */
const HANDED_OFF: MessageStatus[] = ['sent', 'delivered', 'delayed', 'bounced', 'complained']

const DAY_MS = 86_400_000

/** Read model behind the Transactional dashboard page, for one organization. */
export class TransactionalOverviewQuery {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  /** Transactional emails created in [from, to), by current status. */
  async window(from: Date, to: Date): Promise<TransactionalWindow> {
    const rows = await this.db
      .select({ status: messages.status, value: count() })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.kind, 'transactional'),
          gte(messages.createdAt, from),
          lt(messages.createdAt, to)
        )
      )
      .groupBy(messages.status)

    const byStatus: StatusCounts = {}

    for (const row of rows) byStatus[row.status] = row.value

    const sum = (statuses: MessageStatus[]) =>
      statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0)

    return {
      total: rows.reduce((acc, r) => acc + r.value, 0),
      sent: sum(HANDED_OFF),
      delivered: byStatus.delivered ?? 0,
      bounced: byStatus.bounced ?? 0,
      failed: sum(['failed', 'rejected']),
      byStatus
    }
  }

  async recent(limit = 10): Promise<TransactionalRecentEmail[]> {
    const rows = await this.db
      .select({
        id: messages.id,
        to: messages.toEmail,
        subject: messages.subject,
        status: messages.status,
        error: messages.error,
        createdAt: messages.createdAt,
        templateId: messages.templateId,
        templateName: templates.name
      })
      .from(messages)
      .leftJoin(
        templates,
        and(eq(templates.id, messages.templateId), this.scope.eq(templates.organizationId))
      )
      .where(and(this.scope.eq(messages.organizationId), eq(messages.kind, 'transactional')))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      to: row.to,
      subject: row.subject,
      status: row.status,
      error: row.error,
      template:
        row.templateId && row.templateName ? { id: row.templateId, name: row.templateName } : null,
      createdAt: row.createdAt.toISOString()
    }))
  }

  /** Transactional templates with how many emails each rendered in the last 7 days. */
  async templates(now = new Date()): Promise<TransactionalTemplateItem[]> {
    const since = new Date(now.getTime() - 7 * DAY_MS)

    const usage = this.db
      .select({ templateId: messages.templateId, sent: count().as('sent') })
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.kind, 'transactional'),
          gte(messages.createdAt, since)
        )
      )
      .groupBy(messages.templateId)
      .as('usage')

    const rows = await this.db
      .select({
        id: templates.id,
        name: templates.name,
        slug: templates.slug,
        subject: templates.subject,
        updatedAt: templates.updatedAt,
        sent7d: sql<number>`coalesce(${usage.sent}, 0)::int`
      })
      .from(templates)
      .leftJoin(usage, eq(usage.templateId, templates.id))
      .where(and(this.scope.eq(templates.organizationId), eq(templates.kind, 'transactional')))
      .orderBy(desc(templates.updatedAt), asc(templates.name))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      subject: row.subject,
      sent7d: row.sent7d,
      updatedAt: row.updatedAt.toISOString()
    }))
  }
}
