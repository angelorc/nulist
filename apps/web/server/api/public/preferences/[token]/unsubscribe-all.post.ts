import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../../lib/optin/headers'

/** Global unsubscribe from the link's organization (other organizations are not affected). */
export default definePublicHandler(async (event, { resolver, actor }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('unsubscribe', token)

  return services.preferences.unsubscribeAll(token, {
    ...actor,
    organizationId: services.organizationId,
    label: 'Preference center'
  })
})
