import type { RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { MlistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type {
  Broadcast,
  BroadcastDetail,
  BroadcastListItem,
  CreateBroadcastOptions,
  ListBroadcastsOptions,
  SendBroadcastOptions,
  UpdateBroadcastOptions
} from '../types/broadcasts'
import type { DeletedResource, Page } from '../types/common'

/** Broadcasts: drafts, sending and scheduling. */
export class Broadcasts {
  constructor(private readonly transport: Transport) {}

  /** Creates a draft. */
  create(
    payload: CreateBroadcastOptions = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Broadcast>> {
    return this.transport.post<Broadcast, CreateBroadcastOptions>(
      RequestPath.of('/broadcasts'),
      payload,
      options
    )
  }

  get(id: string, options: RequestOptions = {}): Promise<MlistResponse<BroadcastDetail>> {
    return this.transport.get<BroadcastDetail>(RequestPath.of('/broadcasts/{id}', { id }), options)
  }

  /** Newest first. */
  list(
    params: ListBroadcastsOptions = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Page<BroadcastListItem>>> {
    return this.transport.get<Page<BroadcastListItem>>(RequestPath.of('/broadcasts'), {
      ...options,
      query: { page: params.page, pageSize: params.pageSize, q: params.q, status: params.status }
    })
  }

  /** Drafts only (`invalid_state` once scheduled). */
  update(
    id: string,
    payload: UpdateBroadcastOptions,
    options: RequestOptions = {}
  ): Promise<MlistResponse<Broadcast>> {
    return this.transport.patch<Broadcast, UpdateBroadcastOptions>(
      RequestPath.of('/broadcasts/{id}', { id }),
      payload,
      options
    )
  }

  /**
   * Drafts, and broadcasts cancelled before sending started (`invalid_state`
   * otherwise: a broadcast that started sending keeps its delivery history).
   */
  remove(
    id: string,
    options: RequestOptions = {}
  ): Promise<MlistResponse<DeletedResource<'broadcast'>>> {
    return this.transport.delete<DeletedResource<'broadcast'>>(
      RequestPath.of('/broadcasts/{id}', { id }),
      options
    )
  }

  /**
   * Sends a draft now (HTTP 202), or schedules it with `scheduledAt`. Pre-flight
   * blockers (no audience, no sender…) fail with `validation_error`.
   */
  send(
    id: string,
    payload: SendBroadcastOptions = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Broadcast>> {
    return this.transport.post<Broadcast, SendBroadcastOptions>(
      RequestPath.of('/broadcasts/{id}/send', { id }),
      payload,
      options
    )
  }

  /** Stops a scheduled, sending or paused broadcast; emails not yet handed off are dropped. */
  cancel(id: string, options: RequestOptions = {}): Promise<MlistResponse<Broadcast>> {
    return this.transport.post<Broadcast>(
      RequestPath.of('/broadcasts/{id}/cancel', { id }),
      undefined,
      options
    )
  }
}
