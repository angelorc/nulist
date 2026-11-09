import { preferencesUpdateSchema, recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS } from '../../../lib/optin/headers'

/** List and topic switches; ids of another organization are "not found". */
export default definePublicHandler(async (event, { resolver, actor }) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const body = await readValidatedBody(event, preferencesUpdateSchema.parse)
  const { services } = await resolver.fromToken('unsubscribe', token)

  return services.preferences.updatePreferences(token, body, {
    ...actor,
    organizationId: services.organizationId,
    label: 'Preference center'
  })
})
