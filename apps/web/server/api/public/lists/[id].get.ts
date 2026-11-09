import { publicListParamsSchema } from '#shared/schemas/public'
import { PublicSignup } from '../../../lib/optin/PublicSignup'

/**
 * Public list info and branding for the hosted signup form. Unknown, private
 * and deleted lists all answer the same 404.
 */
export default definePublicHandler(async (event, { resolver }) => {
  const { id } = await getValidatedRouterParams(event, publicListParamsSchema.parse)
  const signup = await PublicSignup.forList(resolver, id)

  return signup.publicList(id)
})
