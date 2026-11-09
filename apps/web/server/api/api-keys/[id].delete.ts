import { z } from 'zod'
import { BetterAuthApiKeyIssuer } from '../../lib/settings/api-keys/ApiKeyIssuer'
import { apiKeyApi } from '../../lib/settings/auth/BetterAuthApi'

const paramsSchema = z.object({ id: z.uuid() })

/** Revokes an API key of the active organization immediately (404 for other organizations' keys). */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

    const keys = services.apiKeys(new BetterAuthApiKeyIssuer(apiKeyApi(serverAuth(event).api)))

    await keys.revoke(id, actor, event.headers)

    return { ok: true }
  },
  { permission: { apiKey: ['delete'] } }
)
