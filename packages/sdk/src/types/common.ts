/** `page` (from 1) and `pageSize` (1-100, default 25) of every list call. */
export interface PageParams {
  page?: number
  pageSize?: number
}

/** The envelope of every list call. */
export interface Page<T> {
  object: 'list'
  data: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

/** Resources a `remove` call deletes. */
export type DeletableObject = 'contact' | 'mailing_list' | 'broadcast' | 'template'

export interface DeletedResource<O extends DeletableObject> {
  id: string
  object: O
  deleted: true
}
