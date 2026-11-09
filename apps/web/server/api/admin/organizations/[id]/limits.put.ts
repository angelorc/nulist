import { z } from 'zod'
import { organizationLimitsSchema } from '#shared/schemas/organization'
import type { AdminOrganizationLimits } from '#shared/schemas/organization'

const paramsSchema = z.object({ id: z.string().min(1) })

/** Sets an organization's limits (instance administrators; audited in that organization). */
export default defineInstanceAdminHandler(
  async (event, { platform, actor }): Promise<AdminOrganizationLimits> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
    const organization = await platform.organizations.get(id)
    const input = await readValidatedBody(event, organizationLimitsSchema.parse)
    const limits = await platform.organizations.updateLimits(organization.id, input, actor)

    return { organization, limits, usage: await platform.forOrganization(id).limits.usage() }
  }
)
