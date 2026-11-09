import { addDomainSchema } from '#shared/schemas/domains'

/**
 * Adds a domain identity to Amazon SES (Easy DKIM) for the active organization
 * and returns the records to publish.
 */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { domain } = await readValidatedBody(event, addDomainSchema.parse)
    const identity = await services.domains.addDomain(domain)

    await services.audit.log(actor, {
      action: 'domain.added',
      entityType: 'domain',
      entityId: domain,
      summary: `Added sending domain ${domain}`,
      changes: { dkimTokens: identity.dkim.tokens.length }
    })

    return identity
  },
  { permission: { domain: ['create'] } }
)
