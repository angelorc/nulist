import { API_KEY_SCOPES } from '#shared/auth/permissions'
import { apiKeyCreateSchema } from '#shared/schemas/api-keys'
import { PermissionDeniedError } from '../../lib/core/errors'
import { BetterAuthApiKeyIssuer } from '../../lib/settings/api-keys/ApiKeyIssuer'
import { apiKeyApi } from '../../lib/settings/auth/BetterAuthApi'

/**
 * Creates an API key owned by the active organization. A key never grants more
 * than its creator's role does. The response is the only time the plain key is shown.
 */
export default defineApiHandler(
  async (event, { services, actor, user, can }) => {
    const input = await readValidatedBody(event, apiKeyCreateSchema.parse)
    const permissions = API_KEY_SCOPES[input.scope]

    if (!can(permissions)) throw new PermissionDeniedError(permissions)

    const keys = services.apiKeys(new BetterAuthApiKeyIssuer(apiKeyApi(serverAuth(event).api)))

    setResponseHeader(event, 'cache-control', 'no-store')

    return keys.create(input, user.id, actor)
  },
  { permission: { apiKey: ['create'] } }
)
