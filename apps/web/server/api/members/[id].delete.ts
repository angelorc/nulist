import { z } from 'zod'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

const paramsSchema = z.object({ id: z.uuid() })

/** Removes a member from the active organization; their account is kept. */
export default defineApiHandler(
  async (event, { services, actor }): Promise<{ ok: true }> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

    await services.members.remove(
      id,
      actor,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )

    return { ok: true }
  },
  { permission: { member: ['delete'] } }
)
