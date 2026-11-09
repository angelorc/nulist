import { settingsSectionParamsSchema } from '../../lib/settings/sections'

/**
 * One settings section of the active organization with secrets masked (safe
 * for the browser). Limits are readable here; only instance admins change them.
 */
export default defineApiHandler(
  async (event, { services }) => {
    const { section } = await getValidatedRouterParams(event, settingsSectionParamsSchema.parse)

    return services.settings.getMasked(section)
  },
  { permission: { settings: ['read'] } }
)
