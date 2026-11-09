import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../../lib/optin/headers'

/** Subject, sender and date for the web view's top bar. */
export default definePublicHandler(async (event, { resolver }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('web', token)

  return services.webView.meta(token)
})
