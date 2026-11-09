import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../lib/optin/headers'

/**
 * Read-only: what the confirmation link is about, in the organization the link
 * was signed for. Never confirms (link scanners prefetch GETs).
 */
export default definePublicHandler(async (event, { resolver }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('optin', token)

  return services.optIn.inspect(token)
})
