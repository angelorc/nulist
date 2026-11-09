import { confirmSubscriptionSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../lib/optin/headers'

/** The explicit "Confirm subscription" click, in the organization the link was signed for. */
export default definePublicHandler(async (event, { resolver, actor }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await readValidatedBody(event, confirmSubscriptionSchema.parse)
  const { services } = await resolver.fromToken('optin', token)

  return services.optIn.confirm(token, {
    ...actor,
    organizationId: services.organizationId,
    label: 'Opt-in confirmation'
  })
})
