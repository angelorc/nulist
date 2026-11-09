import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../../lib/optin/headers'

/** Undoes the recipient's own global unsubscribe in the link's organization. */
export default definePublicHandler(async (event, { resolver, actor }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('unsubscribe', token)

  return services.preferences.resubscribe(token, {
    ...actor,
    organizationId: services.organizationId,
    label: 'Preference center'
  })
})
