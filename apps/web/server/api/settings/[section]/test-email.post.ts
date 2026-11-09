import { z } from 'zod'
import { testEmailSchema } from '#shared/schemas/domains'

const paramsSchema = z.object({ section: z.literal('sending') })

/**
 * POST /api/settings/sending/test-email: sends a small branded test email
 * through the active organization's saved provider and default sender.
 */
export default defineApiHandler(
  async (event, { services, actor }) => {
    await getValidatedRouterParams(event, paramsSchema.parse)
    const { to } = await readValidatedBody(event, testEmailSchema.parse)

    return services.diagnostics.sendTestEmail(to, actor)
  },
  { permission: { settings: ['update'] } }
)
