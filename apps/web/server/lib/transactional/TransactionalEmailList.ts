import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { messages } from '../../db/schema'
import type { V1EmailListQuery } from '../../../shared/schemas/v1'
import type { Paginated } from '../../../shared/types/domain'
import { Page } from '../core/pagination'
import type { TenantScope } from '../core/TenantScope'
import type { TransactionalEmailRow } from './TransactionalPresenter'

/** Columns of the public representation (the stored HTML and text stay in the database). */
const EMAIL_COLUMNS = {
  id: messages.id,
  status: messages.status,
  toEmail: messages.toEmail,
  fromEmail: messages.fromEmail,
  replyTo: messages.replyTo,
  subject: messages.subject,
  templateId: messages.templateId,
  topicId: messages.topicId,
  tags: messages.tags,
  error: messages.error,
  scheduledAt: messages.scheduledAt,
  sentAt: messages.sentAt,
  deliveredAt: messages.deliveredAt,
  openedAt: messages.openedAt,
  clickedAt: messages.clickedAt,
  createdAt: messages.createdAt
}

/** Paginated read model of one organization's transactional emails (REST API v1), newest first. */
export class TransactionalEmailList {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async page(query: V1EmailListQuery): Promise<Paginated<TransactionalEmailRow>> {
    const page = Page.from(query)

    const where = and(
      this.scope.eq(messages.organizationId),
      eq(messages.kind, 'transactional'),
      query.status ? eq(messages.status, query.status) : undefined
    )

    const [rows, [total]] = await Promise.all([
      this.db
        .select(EMAIL_COLUMNS)
        .from(messages)
        .where(where)
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(messages).where(where)
    ])

    return page.wrap(rows, total?.value ?? 0)
  }
}
