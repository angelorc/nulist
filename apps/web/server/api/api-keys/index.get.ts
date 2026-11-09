import { BetterAuthApiKeyIssuer } from '../../lib/settings/api-keys/ApiKeyIssuer'
import { apiKeyApi } from '../../lib/settings/auth/BetterAuthApi'

/** API keys of the active organization (never the secret), newest first. */
export default defineApiHandler(
  (event, { services }) =>
    services.apiKeys(new BetterAuthApiKeyIssuer(apiKeyApi(serverAuth(event).api))).list(),
  { permission: { apiKey: ['read'] } }
)
