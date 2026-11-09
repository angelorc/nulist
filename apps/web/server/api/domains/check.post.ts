import { domainCheckSchema } from '#shared/schemas/domains'

/**
 * Live DNS checks (SPF, DKIM, DMARC, MAIL FROM MX) for any domain, with
 * guidance. Read-only despite the POST; SES records are looked up only for the
 * organization's own identities.
 */
export default defineApiHandler(
  async (event, { services }) => {
    const { domain, dkimTokens, mailFromDomain } = await readValidatedBody(
      event,
      domainCheckSchema.parse
    )

    return services.domains.checkDomain(domain, { dkimTokens, mailFromDomain })
  },
  { permission: { domain: ['read'] } }
)
