import type {
  V1DeletedResource,
  V1List,
  V1ListCreateInput,
  V1ListUpdateInput,
  V1Page,
  V1PageQuery
} from '../../../shared/schemas/v1'
import type { Actor } from '../core/actor'
import type { ListService, ListWithCounts } from '../lists/ListService'
import { V1Presenter } from './V1Presenter'

/**
 * REST API v1 lists resource of one organization. Business rules (limits,
 * audit, tenant isolation) stay in the organization's ListService; another
 * organization's list ids are not found.
 */
export class ListApi {
  constructor(private readonly lists: ListService) {}

  static present(list: ListWithCounts): V1List {
    return {
      id: list.id,
      object: 'mailing_list',
      name: list.name,
      description: list.description,
      optIn: list.optIn,
      isPublic: list.isPublic,
      confirmedCount: list.confirmedCount,
      unconfirmedCount: list.unconfirmedCount,
      unsubscribedCount: list.unsubscribedCount,
      createdAt: V1Presenter.iso(list.createdAt),
      updatedAt: V1Presenter.iso(list.updatedAt)
    }
  }

  async list(query: V1PageQuery): Promise<V1Page<V1List>> {
    const lists = await this.lists.list()

    return V1Presenter.page(V1Presenter.slice(lists, query), (list) => ListApi.present(list))
  }

  async get(id: string): Promise<V1List> {
    return ListApi.present(await this.lists.get(id))
  }

  async create(input: V1ListCreateInput, actor: Actor): Promise<V1List> {
    const list = await this.lists.create(input, actor)

    return this.get(list.id)
  }

  /** An empty patch changes nothing (but still 404s for a list that is not the organization's). */
  async update(id: string, input: V1ListUpdateInput, actor: Actor): Promise<V1List> {
    if (Object.keys(input).length) await this.lists.update(id, input, actor)

    return this.get(id)
  }

  async delete(id: string, actor: Actor): Promise<V1DeletedResource<'mailing_list'>> {
    await this.lists.delete(id, actor)

    return { id, object: 'mailing_list', deleted: true }
  }
}
