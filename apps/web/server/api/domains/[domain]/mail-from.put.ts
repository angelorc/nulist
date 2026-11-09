import { domainParamsSchema, mailFromSchema } from '#shared/schemas/domains'

/** Sets (or clears) the custom MAIL FROM domain of an SES identity of the active organization. */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { domain } = await getValidatedRouterParams(event, domainParamsSchema.parse)
    const input = await readValidatedBody(event, mailFromSchema.parse)
    const before = await services.domains.getIdentity(domain)
    const identity = await services.domains.setMailFrom(domain, input)

    await services.audit.log(actor, {
      action: 'domain.mail_from_updated',
      entityType: 'domain',
      entityId: domain,
      summary: input.mailFromDomain
        ? `Set MAIL FROM domain of ${domain} to ${input.mailFromDomain}`
        : `Removed the custom MAIL FROM domain of ${domain}`,
      changes: {
        mailFromDomain: { from: before.mailFrom.domain, to: identity.mailFrom.domain },
        behaviorOnMxFailure: {
          from: before.mailFrom.behaviorOnMxFailure,
          to: identity.mailFrom.behaviorOnMxFailure
        }
      }
    })

    return identity
  },
  { permission: { domain: ['update'] } }
)
