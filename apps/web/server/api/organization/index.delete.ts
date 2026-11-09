import { organizationDeleteSchema } from '#shared/schemas/organization'
import type { ActiveOrganizationChange } from '#shared/schemas/members'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'
import { SessionOrganization } from '../../lib/organizations/SessionOrganization'

/**
 * Deletes the active organization and all its data (body `{ confirmSlug }`),
 * then moves the session to the user's next organization, if any.
 */
export default defineApiHandler(
  async (event, { platform, services, user }): Promise<ActiveOrganizationChange> => {
    const { confirmSlug } = await readValidatedBody(event, organizationDeleteSchema.parse)
    const gateway = OrganizationAuthGateway.from(serverAuth(event).api, event.headers)

    await services.profile.delete(confirmSlug, gateway)

    const { organizationId, cookies } = await new SessionOrganization(
      platform.organizations,
      gateway
    ).fallback(user.id)

    for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie)

    return { organizationId }
  },
  { permission: { organization: ['delete'] } }
)
