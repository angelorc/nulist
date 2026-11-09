import { adminOrganizationCreateSchema } from '#shared/schemas/organization'
import type { AdminOrganizationCreated } from '#shared/schemas/organization'
import { OrganizationAuthGateway } from '../../../lib/organizations/OrganizationAuthGateway'
import { OrganizationDirectory } from '../../../lib/organizations/OrganizationDirectory'

/**
 * Creates an organization for an owner (instance administrators). An owner
 * without an account is invited; the administrator owns it meanwhile.
 */
export default defineInstanceAdminHandler(
  async (event, { platform, user }): Promise<AdminOrganizationCreated> => {
    const input = await readValidatedBody(event, adminOrganizationCreateSchema.parse)

    setResponseStatus(event, 201)

    return OrganizationDirectory.of(platform).create(
      input,
      user,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )
  }
)
