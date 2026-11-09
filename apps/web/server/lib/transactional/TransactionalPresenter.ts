import type { emailEvents, messages } from '../../db/schema'
import type {
  TransactionalEmail,
  TransactionalEmailDetail
} from '../../../shared/schemas/transactional'

type MessageRow = typeof messages.$inferSelect

/** The columns of a message the public representation reads (list queries select only these). */
export type TransactionalEmailRow = Pick<
  MessageRow,
  | 'id'
  | 'status'
  | 'toEmail'
  | 'fromEmail'
  | 'replyTo'
  | 'subject'
  | 'templateId'
  | 'topicId'
  | 'tags'
  | 'error'
  | 'scheduledAt'
  | 'sentAt'
  | 'deliveredAt'
  | 'openedAt'
  | 'clickedAt'
  | 'createdAt'
>

type EventRow = Pick<typeof emailEvents.$inferSelect, 'type' | 'occurredAt' | 'data'>

const iso = (value: Date | null) => (value ? value.toISOString() : null)

/** Maps `messages` rows to the stable REST API representation. */
export class TransactionalPresenter {
  static email(row: TransactionalEmailRow): TransactionalEmail {
    return {
      id: row.id,
      object: 'email',
      status: row.status,
      to: row.toEmail,
      from: row.fromEmail,
      replyTo: row.replyTo,
      subject: row.subject,
      templateId: row.templateId,
      topicId: row.topicId,
      tags: row.tags,
      error: row.error,
      scheduledAt: iso(row.scheduledAt),
      sentAt: iso(row.sentAt),
      deliveredAt: iso(row.deliveredAt),
      openedAt: iso(row.openedAt),
      clickedAt: iso(row.clickedAt),
      createdAt: row.createdAt.toISOString()
    }
  }

  static detail(row: MessageRow, events: EventRow[]): TransactionalEmailDetail {
    return {
      ...TransactionalPresenter.email(row),
      events: events.map((e) => ({
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        data: e.data
      }))
    }
  }
}
