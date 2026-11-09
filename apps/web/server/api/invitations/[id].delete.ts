import { z } from 'zod'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

const paramsSchema = z.object({ id: z.uuid() })

/** Cancels a pending invitation of the active organization. */
export default defineApiHandler(
  async (event, { services }): Promise<{ ok: true }> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

    await services.invitations.cancel(
      id,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )

    return { ok: true }
  },
  { permission: { invitation: ['cancel'] } }
)
