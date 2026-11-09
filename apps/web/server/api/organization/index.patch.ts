import { organizationUpdateSchema } from '#shared/schemas/organization'
import type { OrganizationSummary } from '#shared/types/domain'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

/** Renames the active organization, changes its slug or logo (audited by Better Auth hooks). */
export default defineApiHandler(
  async (event, { services }): Promise<OrganizationSummary> => {
    const input = await readValidatedBody(event, organizationUpdateSchema.parse)

    return services.profile.update(
      input,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )
  },
  { permission: { organization: ['update'] } }
)
