import type { V1Page, V1PageQuery } from '../../../shared/schemas/v1'
import type { Timestamp } from '../../../shared/types/contacts'
import type { Paginated } from '../../../shared/types/domain'
import { Page } from '../core/pagination'

/** Conventions shared by the REST API v1 resources: ISO timestamps and the list envelope. */
export class V1Presenter {
  static iso(value: Timestamp): string {
    return new Date(value).toISOString()
  }

  static isoOrNull(value: Timestamp | null): string | null {
    return value === null ? null : V1Presenter.iso(value)
  }

  /** A service page in the v1 envelope (`object: 'list'`), each item presented by `present`. */
  static page<T, R>(result: Paginated<T>, present: (item: T) => R): V1Page<R> {
    return {
      object: 'list',
      data: result.items.map((item) => present(item)),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      hasMore: result.page * result.pageSize < result.total
    }
  }

  /** Pages a collection a service returns whole (bounded by the organization's limits). */
  static slice<T>(items: readonly T[], query: V1PageQuery): Paginated<T> {
    const page = Page.from(query)

    return page.wrap(items.slice(page.offset, page.offset + page.limit), items.length)
  }
}
