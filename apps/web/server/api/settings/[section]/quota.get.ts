import { z } from 'zod'

const paramsSchema = z.object({ section: z.literal('sending') })

/**
 * GET /api/settings/sending/quota: the SES account quota of the active
 * organization's provider (null for plain SMTP). Errors are reported in the payload.
 */
export default defineApiHandler(
  async (event, { services }) => {
    await getValidatedRouterParams(event, paramsSchema.parse)

    return services.diagnostics.sendingQuota()
  },
  { permission: { settings: ['read'] } }
)
