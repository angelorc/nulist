import type {
  ContactStatus,
  EmailEventType,
  ImportMapping,
  ImportMode,
  ImportRowError,
  ImportStatus,
  JsonObject,
  MessageKind,
  MessageStatus,
  OptInMode,
  SubscriptionStatus,
  SuppressionReason
} from './domain'

/** `Date` on the server, ISO string once serialized over the wire. */
export type Timestamp = Date | string

/** A custom attribute value as stored in `contacts.attributes`. */
export type AttributeValue = string | number | boolean | null

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export interface ContactListItem {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  source: string | null
  /** Lists the contact is subscribed to (confirmed or pending). */
  listCount: number
  lastOpenedAt: Timestamp | null
  createdAt: Timestamp
}

export interface ContactSubscription {
  listId: string
  listName: string
  optIn: OptInMode
  status: SubscriptionStatus
  createdAt: Timestamp
  confirmedAt: Timestamp | null
  unsubscribedAt: Timestamp | null
}

export interface ContactTopicPreference {
  topicId: string
  name: string
  description: string | null
  subscribed: boolean
  /** False when the contact never chose and the topic default applies. */
  explicit: boolean
}

export interface ContactStats {
  messages: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
}

/** A contact as stored (returned by create and update). */
export interface ContactRecord {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  attributes: JsonObject
  status: ContactStatus
  source: string | null
  consentIp: string | null
  consentAt: Timestamp | null
  softBounceCount: number
  lastOpenedAt: Timestamp | null
  lastClickedAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** A contact with its lists, topic preferences, sending stats and suppression. */
export interface ContactDetail extends ContactRecord {
  subscriptions: ContactSubscription[]
  topics: ContactTopicPreference[]
  stats: ContactStats
  suppression: { reason: SuppressionReason; source: string | null; createdAt: Timestamp } | null
}

export type ContactActivityType =
  | 'created'
  | 'subscribed'
  | 'confirmed'
  | 'message'
  | EmailEventType

export interface ContactActivityItem {
  id: string
  type: ContactActivityType
  at: Timestamp
  /** Message subject for message/email events. */
  subject?: string | null
  listName?: string | null
  messageId?: string | null
  messageKind?: MessageKind | null
  messageStatus?: MessageStatus | null
  /** Clicked link, bounce type, unsubscribe source… */
  detail?: string | null
}

export interface BulkActionResult {
  affected: number
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
export type ImportSubscriptionStatus = 'confirmed' | 'send_opt_in'

export interface ImportSummary {
  id: string
  fileName: string
  status: ImportStatus
  mode: ImportMode
  listId: string | null
  listName: string | null
  totalRows: number
  processedRows: number
  createdCount: number
  updatedCount: number
  skippedCount: number
  errorCount: number
  createdAt: Timestamp
  completedAt: Timestamp | null
}

export interface ImportDetail extends ImportSummary {
  mapping: ImportMapping
  subscriptionStatus: ImportSubscriptionStatus
  errors: ImportRowError[]
}
