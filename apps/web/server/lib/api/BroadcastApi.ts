import type {
  V1Broadcast,
  V1BroadcastCreateInput,
  V1BroadcastDetail,
  V1BroadcastListItem,
  V1BroadcastListQuery,
  V1BroadcastSummary,
  V1BroadcastUpdateInput,
  V1DeletedResource,
  V1Page
} from '../../../shared/schemas/v1'
import type { BroadcastListRow } from '../broadcasts/BroadcastQueries'
import type {
  BroadcastDetailRow,
  BroadcastRow,
  BroadcastService
} from '../broadcasts/BroadcastService'
import type { Actor } from '../core/actor'
import { V1Presenter } from './V1Presenter'

/** Columns every broadcast projection (row, list row, detail) carries. */
type BroadcastSummaryRow = Pick<
  BroadcastRow,
  | 'id'
  | 'name'
  | 'subject'
  | 'preheader'
  | 'fromName'
  | 'fromEmail'
  | 'replyTo'
  | 'templateId'
  | 'topicId'
  | 'status'
  | 'scheduledAt'
  | 'startedAt'
  | 'completedAt'
  | 'recipientCount'
  | 'createdAt'
  | 'updatedAt'
>

/**
 * REST API v1 broadcasts resource of one organization. The draft rules, the
 * pre-flight checks and the sending state machine stay in BroadcastService;
 * another organization's broadcast ids are not found.
 */
export class BroadcastApi {
  constructor(private readonly broadcasts: BroadcastService) {}

  static summary(row: BroadcastSummaryRow): V1BroadcastSummary {
    return {
      id: row.id,
      object: 'broadcast',
      name: row.name,
      subject: row.subject,
      preheader: row.preheader,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      replyTo: row.replyTo,
      templateId: row.templateId,
      topicId: row.topicId,
      status: row.status,
      scheduledAt: V1Presenter.isoOrNull(row.scheduledAt),
      startedAt: V1Presenter.isoOrNull(row.startedAt),
      completedAt: V1Presenter.isoOrNull(row.completedAt),
      recipientCount: row.recipientCount,
      createdAt: V1Presenter.iso(row.createdAt),
      updatedAt: V1Presenter.iso(row.updatedAt)
    }
  }

  static present(row: BroadcastRow | BroadcastDetailRow): V1Broadcast {
    return { ...BroadcastApi.summary(row), audience: row.audience, utm: row.utm }
  }

  static listItem(row: BroadcastListRow): V1BroadcastListItem {
    return { ...BroadcastApi.summary(row), stats: row.stats }
  }

  async list(query: V1BroadcastListQuery): Promise<V1Page<V1BroadcastListItem>> {
    const page = await this.broadcasts.list(query)

    return V1Presenter.page(page, (row) => BroadcastApi.listItem(row))
  }

  async get(id: string): Promise<V1BroadcastDetail> {
    const detail = await this.broadcasts.get(id)

    return { ...BroadcastApi.present(detail), progress: detail.progress }
  }

  async create(input: V1BroadcastCreateInput, actor: Actor): Promise<V1Broadcast> {
    return BroadcastApi.present(await this.broadcasts.create(input, actor))
  }

  /** Drafts only (`invalid_state` otherwise). */
  async update(id: string, input: V1BroadcastUpdateInput, actor: Actor): Promise<V1Broadcast> {
    return BroadcastApi.present(await this.broadcasts.update(id, input, actor))
  }

  /**
   * Drafts, and broadcasts cancelled before they started sending (`invalid_state`
   * otherwise): BroadcastService enforces the rule shared with the dashboard.
   */
  async delete(id: string, actor: Actor): Promise<V1DeletedResource<'broadcast'>> {
    await this.broadcasts.delete(id, actor)

    return { id, object: 'broadcast', deleted: true }
  }

  /** Sends a draft now (`scheduledAt` null) or schedules it, after the pre-flight checks. */
  async send(id: string, scheduledAt: Date | null, actor: Actor): Promise<V1Broadcast> {
    return BroadcastApi.present(await this.broadcasts.schedule(id, scheduledAt, actor))
  }

  /** Stops a scheduled, sending or paused broadcast; emails not handed to the provider are dropped. */
  async cancel(id: string, actor: Actor): Promise<V1Broadcast> {
    return BroadcastApi.present(await this.broadcasts.cancel(id, actor))
  }
}
