import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { contacts, emailEvents, listSubscriptions, lists, messages } from '../../db/schema'
import type { ContactActivityItem } from '../../../shared/types/contacts'
import type { JsonObject } from '../../../shared/types/domain'
import type { TenantScope } from '../core/TenantScope'

const MESSAGE_WINDOW = 50

const DETAIL_KEYS = ['url', 'link', 'bounceType', 'bounceSubType', 'reason', 'source', 'error']

const detailSchema = z.string().min(1)

/** The fields of an `unsubscribe` event shown in the timeline (other shapes read as null). */
const unsubscribeDataSchema = z.object({
  listName: z.string().nullable().catch(null),
  source: z.string().nullable().catch(null)
})

/** Picks a short human detail out of an event payload (clicked link, bounce type…). */
function eventDetail(data: JsonObject): string | null {
  for (const key of DETAIL_KEYS) {
    const value = detailSchema.safeParse(data[key])

    if (value.success) return value.data.slice(0, 500)
  }

  return null
}

/**
 * Builds a contact's activity timeline from messages, email events and list
 * membership history (unsubscribes come from `unsubscribe` email events).
 * Events are fetched through the contact's messages so the indexed
 * `message_id` path is used instead of scanning `email_events`.
 * Every read is limited to the scope's organization.
 */
export class ContactActivityReader {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async read(contactId: string, limit: number): Promise<ContactActivityItem[]> {
    const [contact] = await this.db
      .select({ createdAt: contacts.createdAt, source: contacts.source })
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId)))

    if (!contact) return []

    const [recentMessages, subscriptions, unsubscribeEvents] = await Promise.all([
      this.db
        .select({
          id: messages.id,
          kind: messages.kind,
          subject: messages.subject,
          status: messages.status,
          createdAt: messages.createdAt
        })
        .from(messages)
        .where(and(this.scope.eq(messages.organizationId), eq(messages.contactId, contactId)))
        .orderBy(desc(messages.createdAt))
        .limit(MESSAGE_WINDOW),
      this.db
        .select({
          listName: lists.name,
          createdAt: listSubscriptions.createdAt,
          confirmedAt: listSubscriptions.confirmedAt
        })
        .from(listSubscriptions)
        .innerJoin(lists, eq(lists.id, listSubscriptions.listId))
        .where(
          and(this.scope.eq(lists.organizationId), eq(listSubscriptions.contactId, contactId))
        ),
      this.db
        .select({ id: emailEvents.id, occurredAt: emailEvents.occurredAt, data: emailEvents.data })
        .from(emailEvents)
        .where(
          and(
            this.scope.eq(emailEvents.organizationId),
            eq(emailEvents.type, 'unsubscribe'),
            eq(emailEvents.contactId, contactId),
            isNull(emailEvents.messageId)
          )
        )
        .orderBy(desc(emailEvents.occurredAt))
        .limit(limit)
    ])

    const messageById = new Map(recentMessages.map((m) => [m.id, m]))

    const events = messageById.size
      ? await this.db
          .select({
            id: emailEvents.id,
            messageId: emailEvents.messageId,
            type: emailEvents.type,
            occurredAt: emailEvents.occurredAt,
            data: emailEvents.data
          })
          .from(emailEvents)
          .where(
            and(
              this.scope.eq(emailEvents.organizationId),
              inArray(emailEvents.messageId, [...messageById.keys()])
            )
          )
          .orderBy(desc(emailEvents.occurredAt))
          .limit(limit * 2)
      : []

    const items: ContactActivityItem[] = [
      { id: 'created', type: 'created', at: contact.createdAt, detail: contact.source },
      ...recentMessages.map((m): ContactActivityItem => ({
        id: `message:${m.id}`,
        type: 'message',
        at: m.createdAt,
        subject: m.subject,
        messageId: m.id,
        messageKind: m.kind,
        messageStatus: m.status
      })),
      ...events.map((e): ContactActivityItem => {
        const message = e.messageId ? messageById.get(e.messageId) : undefined

        return {
          id: `event:${e.id}`,
          type: e.type,
          at: e.occurredAt,
          subject: message?.subject ?? null,
          messageId: e.messageId,
          messageKind: message?.kind ?? null,
          detail: eventDetail(e.data)
        }
      }),
      ...unsubscribeEvents.map((e): ContactActivityItem => {
        const data = unsubscribeDataSchema.parse(e.data)

        return {
          id: `event:${e.id}`,
          type: 'unsubscribe',
          at: e.occurredAt,
          listName: data.listName,
          detail: data.source
        }
      })
    ]

    for (const s of subscriptions) {
      items.push({
        id: `subscribed:${s.listName}:${s.createdAt.toISOString()}`,
        type: 'subscribed',
        at: s.createdAt,
        listName: s.listName
      })

      if (s.confirmedAt && s.confirmedAt.getTime() - s.createdAt.getTime() > 1000) {
        items.push({
          id: `confirmed:${s.listName}:${s.confirmedAt.toISOString()}`,
          type: 'confirmed',
          at: s.confirmedAt,
          listName: s.listName
        })
      }
    }

    return items
      .toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit)
  }
}
