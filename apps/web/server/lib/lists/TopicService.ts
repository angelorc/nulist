import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { broadcasts, contacts, contactTopics, topics } from '../../db/schema'
import type { TopicInput, TopicUpdate } from '../../../shared/schemas/topics'
import { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ConflictError, NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'

export type TopicRow = typeof topics.$inferSelect

export interface TopicWithStats extends TopicRow {
  /** Contacts that explicitly opted out. */
  optedOutCount: number
  /** Contacts that explicitly opted in. */
  optedInCount: number
}

export interface TopicPreference {
  topic: TopicRow
  subscribed: boolean
}

/** Broadcast states during which deleting the topic would drop the opt-out filter mid-flight. */
const ACTIVE_BROADCAST_STATUSES = ['scheduled', 'sending', 'paused'] as const

/**
 * Topics are notification categories (e.g. "Product updates") a contact can opt
 * out of in the preference center. A contact's explicit choice wins; otherwise
 * the topic's `defaultSubscribed` applies. Every query is restricted to the
 * organization: topics and contacts of another organization behave like missing ones.
 */
export class TopicService {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly audit: AuditLogger
  ) {}

  /**
   * Predicate over `contacts`: the contact accepts email for this topic.
   * Opt-out topics (default on) exclude explicit opt-outs; opt-in topics require an explicit opt-in.
   */
  static acceptsTopicCondition(topic: Pick<TopicRow, 'id' | 'defaultSubscribed'>): SQL {
    const choice = (subscribed: boolean) =>
      sql`exists (select 1 from ${contactTopics} where ${contactTopics.contactId} = ${contacts.id} and ${contactTopics.topicId} = ${topic.id}::uuid and ${contactTopics.subscribed} = ${subscribed})`

    return topic.defaultSubscribed ? sql`not ${choice(false)}` : choice(true)
  }

  async list(): Promise<TopicRow[]> {
    return this.db
      .select()
      .from(topics)
      .where(this.scope.eq(topics.organizationId))
      .orderBy(asc(topics.createdAt))
  }

  async listWithStats(): Promise<TopicWithStats[]> {
    const rows = await this.db
      .select({
        topic: topics,
        optedOutCount: sql<number>`count(${contactTopics.contactId}) filter (where ${contactTopics.subscribed} = false)::int`,
        optedInCount: sql<number>`count(${contactTopics.contactId}) filter (where ${contactTopics.subscribed} = true)::int`
      })
      .from(topics)
      .leftJoin(contactTopics, eq(contactTopics.topicId, topics.id))
      .where(this.scope.eq(topics.organizationId))
      .groupBy(topics.id)
      .orderBy(asc(topics.createdAt))

    return rows.map(({ topic, ...stats }) => ({ ...topic, ...stats }))
  }

  async findOrFail(id: string): Promise<TopicRow> {
    const [row] = await this.db
      .select()
      .from(topics)
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, id)))

    if (!row) throw new NotFoundError('Topic', id)

    return row
  }

  async create(input: TopicInput, actor: Actor): Promise<TopicRow> {
    const [row] = await this.db
      .insert(topics)
      .values(
        this.scope.values({
          name: input.name,
          description: input.description ?? null,
          defaultSubscribed: input.defaultSubscribed
        })
      )
      .returning()

    if (!row) throw new Error('Topic insert returned no row')
    await this.audit.log(actor, {
      action: 'topic.created',
      entityType: 'topic',
      entityId: row.id,
      summary: `Created topic "${row.name}"`
    })

    return row
  }

  async update(id: string, input: TopicUpdate, actor: Actor): Promise<TopicRow> {
    const before = await this.findOrFail(id)
    const patch: Partial<typeof topics.$inferInsert> = {}

    if (input.name !== undefined) patch.name = input.name

    if (input.description !== undefined) patch.description = input.description

    if (input.defaultSubscribed !== undefined) patch.defaultSubscribed = input.defaultSubscribed

    if (!Object.keys(patch).length) return before

    const [row] = await this.db
      .update(topics)
      .set(patch)
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, id)))
      .returning()

    if (!row) throw new NotFoundError('Topic', id)
    await this.audit.log(actor, {
      action: 'topic.updated',
      entityType: 'topic',
      entityId: id,
      summary: `Updated topic "${row.name}"`,
      changes: AuditLogger.diff(before, row)
    })

    return row
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const topic = await this.findOrFail(id)

    const [inUse] = await this.db
      .select({ name: broadcasts.name, status: broadcasts.status })
      .from(broadcasts)
      .where(
        and(
          this.scope.eq(broadcasts.organizationId),
          eq(broadcasts.topicId, id),
          inArray(broadcasts.status, [...ACTIVE_BROADCAST_STATUSES])
        )
      )
      .limit(1)

    if (inUse) {
      throw new ConflictError(
        `Topic is used by the ${inUse.status} broadcast "${inUse.name}". Cancel it or pick another topic first.`,
        'topic_in_use'
      )
    }

    await this.db.delete(topics).where(and(this.scope.eq(topics.organizationId), eq(topics.id, id)))
    await this.audit.log(actor, {
      action: 'topic.deleted',
      entityType: 'topic',
      entityId: id,
      summary: `Deleted topic "${topic.name}"`
    })
  }

  /** Effective preference per topic of the organization for a contact (explicit choice, else topic default). */
  async preferencesFor(contactId: string): Promise<TopicPreference[]> {
    const rows = await this.db
      .select({ topic: topics, explicit: contactTopics.subscribed })
      .from(topics)
      .leftJoin(
        contactTopics,
        and(eq(contactTopics.topicId, topics.id), eq(contactTopics.contactId, contactId))
      )
      .where(this.scope.eq(topics.organizationId))
      .orderBy(asc(topics.createdAt))

    return rows.map(({ topic, explicit }) => ({
      topic,
      subscribed: explicit ?? topic.defaultSubscribed
    }))
  }

  /** Records the contact's explicit choice for a topic (upsert). */
  async setPreference(
    contactId: string,
    topicId: string,
    subscribed: boolean,
    tx: Executor = this.db
  ): Promise<void> {
    const [topic] = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, topicId)))

    if (!topic) throw new NotFoundError('Topic', topicId)

    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), eq(contacts.id, contactId)))

    if (!contact) throw new NotFoundError('Contact', contactId)
    await tx
      .insert(contactTopics)
      .values({ contactId, topicId, subscribed })
      .onConflictDoUpdate({
        target: [contactTopics.contactId, contactTopics.topicId],
        set: { subscribed, updatedAt: new Date() }
      })
  }

  /** Whether the contact accepts email for this topic (respects defaults). */
  async isSubscribed(contactId: string, topicId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ defaultSubscribed: topics.defaultSubscribed, explicit: contactTopics.subscribed })
      .from(topics)
      .leftJoin(
        contactTopics,
        and(eq(contactTopics.topicId, topics.id), eq(contactTopics.contactId, contactId))
      )
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, topicId)))

    if (!row) throw new NotFoundError('Topic', topicId)

    return row.explicit ?? row.defaultSubscribed
  }
}
