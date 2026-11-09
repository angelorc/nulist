import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../lib/optin/headers'

/** The preference center of the organization the link was signed for. */
export default definePublicHandler(async (event, { resolver }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('unsubscribe', token)

  return services.preferences.getPreferences(token)
})
