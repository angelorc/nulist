import type { RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { NulistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type { Page, PageParams } from '../types/common'
import type { ListSegmentContactsOptions, Segment, SegmentContact } from '../types/segments'

export class Segments {
  constructor(private readonly transport: Transport) {}

  get(id: string, options: RequestOptions = {}): Promise<NulistResponse<Segment>> {
    return this.transport.get<Segment>(RequestPath.of('/segments/{id}', { id }), options)
  }

  list(
    params: PageParams = {},
    options: RequestOptions = {}
  ): Promise<NulistResponse<Page<Segment>>> {
    return this.transport.get<Page<Segment>>(RequestPath.of('/segments'), {
      ...options,
      query: { page: params.page, pageSize: params.pageSize }
    })
  }

  listContacts(
    id: string,
    params: ListSegmentContactsOptions = {},
    options: RequestOptions = {}
  ): Promise<NulistResponse<Page<SegmentContact>>> {
    return this.transport.get<Page<SegmentContact>>(
      RequestPath.of('/segments/{id}/contacts', { id }),
      { ...options, query: { page: params.page, pageSize: params.pageSize, q: params.q } }
    )
  }
}
