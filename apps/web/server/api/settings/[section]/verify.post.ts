import { z } from 'zod'
import { sendingSettingsSchema, storageSettingsSchema } from '#shared/schemas/settings'

const paramsSchema = z.object({ section: z.enum(['sending', 'storage']) })

/** Unsaved form values; masked secrets keep their stored value only while the host is unchanged. */
const sendingDraftSchema = z.object({ draft: sendingSettingsSchema.optional() }).optional()
const storageDraftSchema = z.object({ draft: storageSettingsSchema.optional() }).optional()

/**
 * POST /api/settings/sending/verify and /api/settings/storage/verify: tests the
 * saved provider settings, or `draft`. Requires `settings:update` because a
 * draft resolves stored secrets before connecting.
 */
export default defineApiHandler(
  async (event, { services }) => {
    const { section } = await getValidatedRouterParams(event, paramsSchema.parse)

    if (section === 'sending') {
      const body = await readValidatedBody(event, sendingDraftSchema.parse)

      return services.diagnostics.verifySending(body?.draft)
    }

    const body = await readValidatedBody(event, storageDraftSchema.parse)

    return services.diagnostics.verifyStorage(body?.draft)
  },
  { permission: { settings: ['update'] } }
)
