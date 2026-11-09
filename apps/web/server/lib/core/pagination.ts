import type { Paginated } from '../../../shared/types/domain'

export { paginationSchema } from '../../../shared/schemas/pagination'

export type { PaginationQuery } from '../../../shared/schemas/pagination'

export class Page {
  constructor(
    readonly page: number,
    readonly pageSize: number
  ) {}

  static from(query: { page: number; pageSize: number }) {
    return new Page(query.page, query.pageSize)
  }

  get offset() {
    return (this.page - 1) * this.pageSize
  }

  get limit() {
    return this.pageSize
  }

  wrap<T>(items: T[], total: number): Paginated<T> {
    return { items, total, page: this.page, pageSize: this.pageSize }
  }
}
