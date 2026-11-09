import { z } from 'zod'
import { memberUpdateSchema } from '#shared/schemas/members'
import type { OrganizationMember } from '#shared/schemas/members'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

const paramsSchema = z.object({ id: z.uuid() })

/** Changes a member's role in the active organization (through Better Auth). */
export default defineApiHandler(
  async (event, { services, actor }): Promise<OrganizationMember> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
    const { role } = await readValidatedBody(event, memberUpdateSchema.parse)

    return services.members.updateRole(
      id,
      role,
      actor,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )
  },
  { permission: { member: ['update'] } }
)
