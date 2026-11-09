import type { JsonObject } from '../core/json'
import type { PageParams } from './common'

export type ContactStatus = 'active' | 'unsubscribed' | 'bounced' | 'complained' | 'blocklisted'

export type SubscriptionStatus = 'unconfirmed' | 'confirmed' | 'unsubscribed'

/** A custom attribute value (`{{ contact.attributes.<key> }}` in templates). */
export type ContactAttributeValue = string | number | boolean | null

export interface ContactListMembership {
  id: string
  name: string
  status: SubscriptionStatus
}

/** A contact with its list subscriptions. */
export interface Contact {
  id: string
  object: 'contact'
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  attributes: JsonObject
  lists: ContactListMembership[]
  createdAt: string
  updatedAt: string
}

/** A contact as listed by `contacts.list`. */
export interface ContactSummary {
  id: string
  object: 'contact'
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  source: string | null
  /** Lists the contact is subscribed to (confirmed or pending). */
  listCount: number
  lastOpenedAt: string | null
  createdAt: string
}

export type SubscriptionOutcome = 'confirmed' | 'unconfirmed' | 'already_subscribed' | 'skipped'

export interface SubscriptionResult {
  listId: string
  status: SubscriptionOutcome
  /** Why a subscription was skipped (e.g. the contact left that list before). */
  reason?: string
}

/** The result of `contacts.create` (an upsert by email). */
export interface UpsertedContact extends Contact {
  /** False when the email already existed and the contact was updated. */
  created: boolean
  subscriptions: SubscriptionResult[]
}

export interface CreateContactOptions {
  email: string
  firstName?: string | null
  lastName?: string | null
  /** Keys use letters, numbers and `_` (at most 100 attributes). */
  attributes?: Record<string, ContactAttributeValue>
  /** Lists to subscribe the contact to (at most 50). */
  listIds?: string[]
  /** Confirm double opt-in lists immediately (you vouch for consent). */
  skipOptIn?: boolean
}

export interface UpdateContactOptions {
  /** A new address for the contact. */
  email?: string
  /** `null` or `''` clears the name. */
  firstName?: string | null
  lastName?: string | null
  attributes?: Record<string, ContactAttributeValue>
  /** `merge` (default) keeps keys not sent and removes keys set to null; `replace` swaps the object. */
  attributesMode?: 'merge' | 'replace'
  status?: ContactStatus
}

export interface UnsubscribeContactOptions {
  /** Omit to unsubscribe from every email (global opt-out and suppression). */
  listId?: string
}

export type ContactSort =
  | 'email'
  | '-email'
  | 'name'
  | '-name'
  | 'status'
  | '-status'
  | 'createdAt'
  | '-createdAt'
  | 'lastOpenedAt'
  | '-lastOpenedAt'

export interface ListContactsOptions extends PageParams {
  /** Searches email, first and last name. */
  q?: string
  status?: ContactStatus
  /** Current members (confirmed or pending) of a list. */
  listId?: string
  /** `-` sorts descending; default `-createdAt`. */
  sort?: ContactSort
}
