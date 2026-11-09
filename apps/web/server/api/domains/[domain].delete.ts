import { domainParamsSchema } from '#shared/schemas/domains'

/**
 * Removes an identity of the active organization from Amazon SES. Mail from
 * this domain stops being accepted by SES.
 */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { domain } = await getValidatedRouterParams(event, domainParamsSchema.parse)

    await services.domains.removeIdentity(domain)
    await services.audit.log(actor, {
      action: 'domain.removed',
      entityType: 'domain',
      entityId: domain,
      summary: `Removed sending domain ${domain}`
    })

    return { ok: true }
  },
  { permission: { domain: ['delete'] } }
)
