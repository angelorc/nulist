import { and, eq, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { lists, segments, topics } from '../../db/schema'
import { EMPTY_AUDIENCE } from '../../../shared/schemas/broadcasts'
import type { AudienceDefinition } from '../../../shared/types/domain'
import { NotFoundError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { AudienceResolver } from '../segments/AudienceResolver'

/** The list and segment ids of an audience that belong to the organization. */
interface OwnedSources {
  lists: ReadonlySet<string>
  segments: ReadonlySet<string>
}

/**
 * The audience of a broadcast inside one organization. Lists, segments and the
 * topic must belong to the organization: ids of another organization (or deleted
 * ones) never select anyone, so counts and sends cannot reach foreign contacts.
 */
export class BroadcastAudience {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    private readonly resolver: AudienceResolver
  ) {}

  /** The audience without the list and segment ids the organization does not own. */
  async restrict(audience: AudienceDefinition): Promise<AudienceDefinition> {
    const owned = await this.owned(audience)

    return {
      listIds: audience.listIds.filter((id) => owned.lists.has(id)),
      segmentIds: audience.segmentIds.filter((id) => owned.segments.has(id)),
      excludeListIds: audience.excludeListIds.filter((id) => owned.lists.has(id))
    }
  }

  /**
   * Rejects list and segment ids the organization does not own. Ids already in
   * `stored` are accepted, so a draft whose list was deleted can still be saved.
   */
  async assertOwned(
    audience: AudienceDefinition,
    stored: AudienceDefinition = EMPTY_AUDIENCE
  ): Promise<void> {
    const added: AudienceDefinition = {
      listIds: audience.listIds.filter((id) => !stored.listIds.includes(id)),
      segmentIds: audience.segmentIds.filter((id) => !stored.segmentIds.includes(id)),
      excludeListIds: audience.excludeListIds.filter((id) => !stored.excludeListIds.includes(id))
    }

    const owned = await this.owned(added)
    const listIds = [...added.listIds, ...added.excludeListIds]

    if (listIds.some((id) => !owned.lists.has(id)))
      throw new ValidationError('A selected list no longer exists.', { field: 'audience' })

    if (added.segmentIds.some((id) => !owned.segments.has(id)))
      throw new ValidationError('A selected segment no longer exists.', { field: 'audience' })
  }

  /** Sendable recipients of the audience (see AudienceResolver.count). */
  async count(audience: AudienceDefinition, topicId: string | null | undefined): Promise<number> {
    await this.assertTopic(topicId)

    return this.resolver.count(await this.restrict(audience), { topicId })
  }

  /** Sub-select of the recipients' contact ids (see AudienceResolver.recipientIdsQuery). */
  async recipientIdsQuery(
    audience: AudienceDefinition,
    topicId: string | null | undefined
  ): Promise<SQL> {
    await this.assertTopic(topicId)

    return this.resolver.recipientIdsQuery(await this.restrict(audience), { topicId })
  }

  /**
   * The audience as a predicate over `contacts`, without the topic (see
   * AudienceResolver.condition): re-checked at send time, so list unsubscribes
   * and joins to excluded lists after the broadcast started are honoured.
   */
  async condition(audience: AudienceDefinition): Promise<SQL> {
    return this.resolver.condition(await this.restrict(audience))
  }

  private async assertTopic(topicId: string | null | undefined): Promise<void> {
    if (!topicId) return

    const [topic] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .where(and(this.scope.eq(topics.organizationId), eq(topics.id, topicId)))

    if (!topic) throw new NotFoundError('Topic', topicId)
  }

  private async owned(audience: AudienceDefinition): Promise<OwnedSources> {
    const listIds = [...new Set([...audience.listIds, ...audience.excludeListIds])]
    const segmentIds = [...new Set(audience.segmentIds)]

    const [listRows, segmentRows] = await Promise.all([
      listIds.length
        ? this.db
            .select({ id: lists.id })
            .from(lists)
            .where(and(this.scope.eq(lists.organizationId), inArray(lists.id, listIds)))
        : [],
      segmentIds.length
        ? this.db
            .select({ id: segments.id })
            .from(segments)
            .where(and(this.scope.eq(segments.organizationId), inArray(segments.id, segmentIds)))
        : []
    ])

    return {
      lists: new Set(listRows.map((row) => row.id)),
      segments: new Set(segmentRows.map((row) => row.id))
    }
  }
}
