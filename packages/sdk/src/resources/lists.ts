import type { RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { MlistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type { DeletedResource, Page, PageParams } from '../types/common'
import type { CreateListOptions, MailingList, UpdateListOptions } from '../types/lists'

/** Mailing lists. */
export class Lists {
  constructor(private readonly transport: Transport) {}

  create(
    payload: CreateListOptions,
    options: RequestOptions = {}
  ): Promise<MlistResponse<MailingList>> {
    return this.transport.post<MailingList, CreateListOptions>(
      RequestPath.of('/lists'),
      payload,
      options
    )
  }

  get(id: string, options: RequestOptions = {}): Promise<MlistResponse<MailingList>> {
    return this.transport.get<MailingList>(RequestPath.of('/lists/{id}', { id }), options)
  }

  /** Newest first. */
  list(
    params: PageParams = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Page<MailingList>>> {
    return this.transport.get<Page<MailingList>>(RequestPath.of('/lists'), {
      ...options,
      query: { page: params.page, pageSize: params.pageSize }
    })
  }

  update(
    id: string,
    payload: UpdateListOptions,
    options: RequestOptions = {}
  ): Promise<MlistResponse<MailingList>> {
    return this.transport.patch<MailingList, UpdateListOptions>(
      RequestPath.of('/lists/{id}', { id }),
      payload,
      options
    )
  }

  /** Deletes the list and its subscriptions; the contacts are kept. */
  remove(
    id: string,
    options: RequestOptions = {}
  ): Promise<MlistResponse<DeletedResource<'mailing_list'>>> {
    return this.transport.delete<DeletedResource<'mailing_list'>>(
      RequestPath.of('/lists/{id}', { id }),
      options
    )
  }
}
