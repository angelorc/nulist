import { z } from 'zod'
import type { LimitSettings, LimitUsage, OrganizationSummary } from '../types/domain'
import { limitSettingsSchema } from './settings'

export { limitSettingsSchema }

/**
 * Request header carrying the organization a browser tab works in. The server
 * answers 409 `organization_changed` when the session's active organization
 * differs (switched in another tab), so a stale tab never writes elsewhere.
 */
export const ACTIVE_ORGANIZATION_HEADER = 'x-nulist-organization'

/** Error code of that 409. */
export const ORGANIZATION_CHANGED = 'organization_changed'

/** Lowercase words separated by single dashes ("acme-marketing"). */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(80, 'Use at most 80 characters')

/** Unique across the instance (Better Auth `organization.slug`). */
export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters')
  .max(48, 'Use at most 48 characters')
  .regex(ORGANIZATION_SLUG_PATTERN, 'Use lowercase letters, numbers and single dashes')

export const organizationLogoSchema = z
  .url({ protocol: /^https?$/, error: 'Enter an http(s) URL' })
  .max(2048)
  .nullable()

/** PATCH /api/organization: only the fields sent are changed. */
export const organizationUpdateSchema = z.object({
  name: organizationNameSchema.optional(),
  slug: organizationSlugSchema.optional(),
  logo: organizationLogoSchema.optional()
})

export type OrganizationUpdateInput = z.output<typeof organizationUpdateSchema>

/** DELETE /api/organization: the slug, typed to confirm. */
export const organizationDeleteSchema = z.object({
  confirmSlug: z.string().trim().min(1, 'Type the slug to confirm')
})

export type OrganizationDeleteInput = z.output<typeof organizationDeleteSchema>

/** POST /api/admin/organizations (instance administrators). */
export const adminOrganizationCreateSchema = z.object({
  name: organizationNameSchema,
  slug: organizationSlugSchema,
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))
})

export type AdminOrganizationCreateInput = z.output<typeof adminOrganizationCreateSchema>

/** PUT /api/admin/organizations/[id]/limits. */
export const organizationLimitsSchema = limitSettingsSchema

/** A slug suggestion for a name ("Acme Marketing!" → "acme-marketing"). */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
}

// ---------------------------------------------------------------------------
// Limit fields (Settings → Limits and the instance admin's limits editor)
// ---------------------------------------------------------------------------

export interface LimitField {
  key: keyof LimitSettings
  label: string
  help?: string
  unit?: string
  /** UInputNumber step. */
  step?: number
}

export interface LimitFieldGroup {
  id: 'audience' | 'sending' | 'other'
  title: string
  description: string
  fields: readonly LimitField[]
}

export const LIMIT_FIELD_GROUPS: readonly LimitFieldGroup[] = [
  {
    id: 'audience',
    title: 'Audience and content',
    description: 'Caps on how many records can exist. Set 0 for no limit.',
    fields: [
      { key: 'maxContacts', label: 'Contacts', step: 100 },
      { key: 'maxLists', label: 'Lists', step: 100 },
      { key: 'maxSegments', label: 'Segments', step: 100 },
      { key: 'maxTemplates', label: 'Templates', step: 100 }
    ]
  },
  {
    id: 'sending',
    title: 'Sending',
    description: 'Stop sending before you exceed a budget or provider quota. Set 0 for no limit.',
    fields: [
      {
        key: 'dailySendLimit',
        label: 'Emails per 24 hours',
        help: 'Rolling window across broadcasts, transactional and system email.',
        step: 1000
      },
      {
        key: 'monthlySendLimit',
        label: 'Emails per calendar month',
        help: 'Resets on the first day of the month (UTC).',
        step: 1000
      }
    ]
  },
  {
    id: 'other',
    title: 'Imports, files and API',
    description: 'Guards against oversized uploads and runaway integrations. Set 0 for no limit.',
    fields: [
      { key: 'maxImportRows', label: 'Rows per import' },
      { key: 'apiRequestsPerMinute', label: 'API requests per minute', help: 'Per API key.' },
      { key: 'maxFileSizeMb', label: 'Max file size', unit: 'MB' },
      { key: 'maxStorageMb', label: 'Total file storage', unit: 'MB' }
    ]
  }
]

export const LIMIT_FIELDS: readonly LimitField[] = LIMIT_FIELD_GROUPS.flatMap(
  (group) => group.fields
)

// ---------------------------------------------------------------------------
// Wire types (instance administration)
// ---------------------------------------------------------------------------

/** GET /api/admin/organizations: one organization with its usage against its limits. */
export interface AdminOrganizationRow extends OrganizationSummary {
  createdAt: string
  members: number
  /** Whether the signed-in instance administrator is a member (and can switch to it). */
  isMember: boolean
  /** Contacts, emails this month and file storage against their limits. */
  usage: LimitUsage[]
}

/** GET/PUT /api/admin/organizations/[id]/limits. */
export interface AdminOrganizationLimits {
  organization: OrganizationSummary
  limits: LimitSettings
  usage: LimitUsage[]
}

/** POST /api/admin/organizations. */
export interface AdminOrganizationCreated {
  organization: OrganizationSummary
  /** `member`: the owner's account existed; `invited`: they were invited as owner. */
  owner: 'member' | 'invited'
  /** Invitation link for the owner (copy-link fallback), when invited. */
  invitationUrl: string | null
}
