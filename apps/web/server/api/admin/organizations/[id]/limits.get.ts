import { z } from 'zod'
import type { AdminOrganizationLimits } from '#shared/schemas/organization'

const paramsSchema = z.object({ id: z.string().min(1) })

/** An organization's limits and current usage (instance administrators). */
export default defineInstanceAdminHandler(
  async (event, { platform }): Promise<AdminOrganizationLimits> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
    const organization = await platform.organizations.get(id)

    const [limits, usage] = await Promise.all([
      platform.organizations.getLimits(organization.id),
      platform.forOrganization(organization.id).limits.usage()
    ])

    return { organization, limits, usage }
  }
)
