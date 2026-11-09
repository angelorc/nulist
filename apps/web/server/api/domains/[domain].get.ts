import { domainParamsSchema } from '#shared/schemas/domains'

/** One SES identity of the active organization (404 for identities it does not own). */
export default defineApiHandler(
  async (event, { services }) => {
    const { domain } = await getValidatedRouterParams(event, domainParamsSchema.parse)

    return services.domains.getIdentity(domain)
  },
  { permission: { domain: ['read'] } }
)
