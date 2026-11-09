import type { AdminOrganizationRow } from '#shared/schemas/organization'
import { OrganizationDirectory } from '../../../lib/organizations/OrganizationDirectory'

/** Every organization with members and usage against its limits (instance administrators). */
export default defineInstanceAdminHandler(
  (_event, { platform, user }): Promise<AdminOrganizationRow[]> =>
    OrganizationDirectory.of(platform).list(user.id)
)
