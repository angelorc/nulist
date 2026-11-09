/**
 * Domain types shared between the Nuxt app and the Nitro server.
 * Database row types live in `server/db/schema.ts`; these are the
 * JSON shapes and enums that cross the wire.
 */
import type { PermissionRequest } from '../auth/permissions'

export type ContactStatus = 'active' | 'unsubscribed' | 'bounced' | 'complained' | 'blocklisted'

export type SubscriptionStatus = 'unconfirmed' | 'confirmed' | 'unsubscribed'

export type OptInMode = 'single' | 'double'

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'sent'
  | 'cancelled'
  | 'failed'

export type MessageStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'rejected'
  | 'suppressed'
  | 'cancelled'

export type MessageKind = 'broadcast' | 'transactional' | 'system'

export type EmailEventType =
  | 'send'
  | 'delivery'
  | 'bounce'
  | 'complaint'
  | 'reject'
  | 'open'
  | 'click'
  | 'delivery_delay'
  | 'rendering_failure'
  | 'unsubscribe'
  | 'failed'

export type SuppressionReason =
  | 'hard_bounce'
  | 'soft_bounce'
  | 'complaint'
  | 'unsubscribe'
  | 'manual'

export type TemplateKind = 'marketing' | 'transactional'

export type TemplateEditor = 'visual' | 'code'

/** Instance-level role (`user.role`, Better Auth admin plugin). Organization roles live in shared/auth/permissions. */
export type UserRole = 'admin' | 'user'

export type ApiKeyScope = 'full' | 'sending'

export type ImportMode = 'skip' | 'merge' | 'overwrite'

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed'

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
export type SegmentFieldType =
  | 'text'
  | 'enum'
  | 'date'
  | 'number'
  | 'list'
  | 'engagement'
  | 'attribute'

export type SegmentOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_set'
  | 'is_not_set'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'within_days'
  | 'not_within_days'
  | 'in_list'
  | 'not_in_list'
  | 'opened_within_days'
  | 'not_opened_within_days'
  | 'clicked_within_days'
  | 'not_clicked_within_days'

export type SegmentField =
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'source'
  | 'status'
  | 'created_at'
  | 'last_opened_at'
  | 'last_clicked_at'
  | 'list'
  | 'engagement'
  | 'attribute'

export interface SegmentCondition {
  field: SegmentField
  operator: SegmentOperator
  /** Attribute key when `field === 'attribute'`. */
  key?: string
  value?: string | number | null
}

export interface SegmentRules {
  match: 'all' | 'any'
  conditions: SegmentCondition[]
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------
export interface AudienceDefinition {
  listIds: string[]
  segmentIds: string[]
  excludeListIds: string[]
}

export interface UtmSettings {
  enabled: boolean
  source?: string
  medium?: string
  campaign?: string
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
/** Column header → target field (`email`, `first_name`, `last_name`, `attribute:<key>` or `ignore`). */
export type ImportMapping = Record<string, string>

export interface ImportRowError {
  row: number
  email?: string
  message: string
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export interface GeneralSettings {
  appName: string
  companyName: string
  companyAddress: string
  defaultFromName: string
  defaultFromEmail: string
  defaultReplyTo: string
}

export interface SendingSettings {
  provider: 'ses' | 'smtp'
  ses: {
    region: string
    accessKeyId: string
    secretAccessKey: string
    configurationSet: string
  }
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    pass: string
    /** Add X-SES-CONFIGURATION-SET / X-SES-MESSAGE-TAGS headers (SES SMTP interface). */
    sesHeaders: boolean
    configurationSet: string
  }
  /** Max messages per second for broadcasts (keep below the SES MaxSendRate). */
  ratePerSecond: number
  /** Soft bounces within the window before a contact is suppressed. */
  softBounceThreshold: number
  /** Days before an unconfirmed double opt-in expires. */
  optInExpiryDays: number
}

export interface StorageSettings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicUrl: string
  forcePathStyle: boolean
}

/** 0 means unlimited. */
export interface LimitSettings {
  maxContacts: number
  maxLists: number
  maxSegments: number
  maxTemplates: number
  dailySendLimit: number
  monthlySendLimit: number
  maxImportRows: number
  maxFileSizeMb: number
  maxStorageMb: number
  apiRequestsPerMinute: number
}

export interface SettingsMap {
  general: GeneralSettings
  sending: SendingSettings
  storage: StorageSettings
  limits: LimitSettings
}

export type SettingsSection = keyof SettingsMap

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export interface MetricPoint {
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
}

export interface Kpi {
  key: string
  label: string
  value: number
  previous: number
  format: 'number' | 'percent'
  /** Whether a higher value is good (drives delta color). */
  higherIsBetter: boolean
  spark: number[]
}

export interface LimitUsage {
  key: keyof LimitSettings
  label: string
  used: number
  limit: number
  unit?: string
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  logo: string | null
}

/** An organization the signed-in user belongs to, with their (possibly comma-separated) role. */
export interface OrganizationMembership extends OrganizationSummary {
  role: string
}

/** GET /api/organization: the active organization and what the signed-in user may do in it. */
export interface OrganizationContext {
  /** Null when the session has no active organization (or the membership was removed). */
  organization: OrganizationSummary | null
  role: string | null
  permissions: PermissionRequest
  organizations: OrganizationMembership[]
  /** `user.role === 'admin'`: may create organizations and manage their limits. */
  isInstanceAdmin: boolean
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------
export type JsonPrimitive = string | number | boolean | null

/** A JSON-serializable value (what crosses the wire and what jsonb columns hold). */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject

export type JsonObject = { readonly [key: string]: JsonValue | undefined }
