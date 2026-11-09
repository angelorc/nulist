import { z } from 'zod'
import type { SettingsSection } from '../../../shared/types/domain'

export const SETTINGS_SECTIONS = [
  'general',
  'sending',
  'storage',
  'limits'
] as const satisfies readonly SettingsSection[]

/** Sections organization roles with `settings:update` may write. Limits belong to the instance admin. */
export const ORG_SETTINGS_SECTIONS = [
  'general',
  'sending',
  'storage'
] as const satisfies readonly SettingsSection[]

export type OrgSettingsSection = (typeof ORG_SETTINGS_SECTIONS)[number]

export function isOrgSettingsSection(section: SettingsSection): section is OrgSettingsSection {
  return section !== 'limits'
}

export const SETTINGS_SECTION_LABELS = {
  general: 'general',
  sending: 'sending',
  storage: 'storage',
  limits: 'limit'
} as const satisfies Record<SettingsSection, string>

/** Route params for GET /api/settings/[section] (every section is readable with `settings:read`). */
export const settingsSectionParamsSchema = z.object({
  section: z.enum(SETTINGS_SECTIONS)
})

/** Route params for writes (PUT, verify, test email): limits are not writable by organizations. */
export const orgSettingsSectionParamsSchema = z.object({
  section: z.enum(ORG_SETTINGS_SECTIONS)
})
