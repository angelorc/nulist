import { settingsSchemas } from '#shared/schemas/settings'
import { AuditLogger } from '../../lib/audit/AuditLogger'
import { ForbiddenError } from '../../lib/core/errors'
import {
  SETTINGS_SECTION_LABELS,
  isOrgSettingsSection,
  settingsSectionParamsSchema
} from '../../lib/settings/sections'

/**
 * Replaces a settings section of the active organization. Sending the mask for
 * a secret keeps the stored value. Limits are set by instance administrators
 * (PUT /api/admin/organizations/[id]/limits), so they are refused here.
 */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { section } = await getValidatedRouterParams(event, settingsSectionParamsSchema.parse)

    if (!isOrgSettingsSection(section))
      throw new ForbiddenError('Limits are set by your instance administrator.')

    const body = await readValidatedBody(event, (input) => settingsSchemas[section].parse(input))
    const { before, after } = await services.settings.update(section, body)
    const changes = AuditLogger.diff(before, after)

    if (Object.keys(changes).length) {
      await services.audit.log(actor, {
        action: 'settings.updated',
        entityType: 'settings',
        entityId: section,
        summary: `Updated ${SETTINGS_SECTION_LABELS[section]} settings`,
        changes
      })
    }

    return after
  },
  { permission: { settings: ['update'] } }
)
