export type OptInMode = 'single' | 'double'

/** A mailing list with its subscriber counts. */
export interface MailingList {
  id: string
  object: 'mailing_list'
  name: string
  description: string | null
  optIn: OptInMode
  /** Offered on the public sign-up and preference pages. */
  isPublic: boolean
  confirmedCount: number
  unconfirmedCount: number
  unsubscribedCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateListOptions {
  name: string
  description?: string | null
  /** Default `single`. */
  optIn?: OptInMode
  /** Default `true`. */
  isPublic?: boolean
}

export interface UpdateListOptions {
  name?: string
  description?: string | null
  optIn?: OptInMode
  isPublic?: boolean
}
