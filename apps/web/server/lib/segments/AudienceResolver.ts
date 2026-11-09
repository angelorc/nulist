import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, listSubscriptions, segments, suppressions, topics } from '../../db/schema'
import type { AudienceDefinition, SubscriptionStatus } from '../../../shared/types/domain'
import { NotFoundError } from '../core/errors'
import { TopicService } from '../lists/TopicService'
import type { TenantScope } from '../core/TenantScope'
import { confirmedMembership } from './conditions/ListMembershipCompiler'
import type { SegmentQueryBuilder } from './SegmentQueryBuilder'

export interface AudienceOptions {
  /** When set, only contacts that accept this topic (explicit choice, else the topic default). */
  topicId?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uniqueIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => UUID.test(id)))]
}

/** The contact has a subscription in this state on any of its lists. */
function hasSubscription(status: SubscriptionStatus): SQL {
  return sql`exists (select 1 from ${listSubscriptions} where ${listSubscriptions.contactId} = ${contacts.id} and ${eq(listSubscriptions.status, status)})`
}

/**
 * Resolves a broadcast audience (lists ∪ segments − excluded lists) into the
 * set of sendable contacts of one organization. The produced SQL is a standalone
 * sub-select that returns a single column `contact_id` (uuid, distinct), so callers
 * can embed it, e.g. `INSERT INTO messages (...) SELECT ... FROM contacts WHERE id IN (<query>)`.
 * Only the organization's contacts, lists, segments, topic and suppressions are
 * considered: ids of another organization match nobody.
 */
export class AudienceResolver {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly builder: SegmentQueryBuilder
  ) {}

  /**
   * SQL selecting `contacts.id` of every sendable recipient: (confirmed members of listIds ∪ segment
   * matches that are not awaiting consent)
   * − members of excludeListIds, restricted to contacts.status = 'active' and not suppressed. Distinct ids.
   * Column: `contact_id`.
   */
  async recipientIdsQuery(
    audience: AudienceDefinition,
    options: AudienceOptions = {}
  ): Promise<SQL> {
    const where = await this.condition(audience, options)

    return sql`select distinct ${contacts.id} as contact_id from ${contacts} where ${where}`
  }

  async count(audience: AudienceDefinition, options: AudienceOptions = {}): Promise<number> {
    const query = await this.recipientIdsQuery(audience, options)

    const result = await this.db.execute<{ total: number }>(
      sql`select count(*)::int as total from (${query}) as recipients`
    )

    return result.rows[0]?.total ?? 0
  }

  /** The audience as a predicate over `contacts` (for composing into other queries). */
  async condition(audience: AudienceDefinition, options: AudienceOptions = {}): Promise<SQL> {
    const listIds = uniqueIds(audience.listIds)
    const segmentIds = uniqueIds(audience.segmentIds)
    const excludeListIds = uniqueIds(audience.excludeListIds)

    const sources: SQL[] = []

    if (listIds.length) sources.push(confirmedMembership(this.scope, listIds))

    if (segmentIds.length) {
      const rows = await this.db
        .select({ rules: segments.rules })
        .from(segments)
        .where(and(this.scope.eq(segments.organizationId), inArray(segments.id, segmentIds)))

      if (rows.length) {
        const matches = rows.map((row) => sql`(${this.builder.build(row.rules, this.scope)})`)
        sources.push(
          sql`((${sql.join(matches, sql` or `)}) and ${AudienceResolver.consentGiven()})`
        )
      }
    }

    if (!sources.length) return sql`false`

    const parts: SQL[] = [
      this.scope.eq(contacts.organizationId),
      sql`${contacts.status} = 'active'`,
      // Suppressions are per organization: another organization's suppression never blocks this one.
      sql`not exists (select 1 from ${suppressions} where ${suppressions.organizationId} = ${contacts.organizationId} and ${suppressions.email} = lower(${contacts.email}))`,
      sql`(${sql.join(sources, sql` or `)})`
    ]

    if (excludeListIds.length)
      parts.push(sql`not ${confirmedMembership(this.scope, excludeListIds)}`)

    if (options.topicId) parts.push(await this.topicCondition(options.topicId))

    return sql`(${sql.join(parts, sql` and `)})`
  }

  /**
   * Segments match contact fields, not subscriptions, so a contact reached through a segment
   * must not be awaiting consent: it is on a confirmed list, or it has no pending opt-in and
   * did not come from the public form without confirming (an expired opt-in drops the
   * pending row but leaves the contact).
   */
  private static consentGiven(): SQL {
    return sql`(${hasSubscription('confirmed')} or not (${hasSubscription('unconfirmed')} or (${contacts.source} = 'form' and ${contacts.consentAt} is null)))`
  }

  private async topicCondition(topicId: string): Promise<SQL> {
    if (!UUID.test(topicId)) throw new NotFoundError('Topic', topicId)

    const [topic] = await this.db
      .select({ id: topics.id, defaultSubscribed: topics.defaultSubscribed })
      .from(topics)
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, topicId)))

    if (!topic) throw new NotFoundError('Topic', topicId)

    return TopicService.acceptsTopicCondition(topic)
  }
}
