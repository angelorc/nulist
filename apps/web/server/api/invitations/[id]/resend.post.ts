import { z } from 'zod'
import type { PendingInvitation } from '#shared/schemas/members'
import { OrganizationAuthGateway } from '../../../lib/organizations/OrganizationAuthGateway'

const paramsSchema = z.object({ id: z.uuid() })

/** Sends a pending invitation again and renews its expiry. */
export default defineApiHandler(
  async (event, { services, actor }): Promise<PendingInvitation> => {
    const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

    return services.invitations.resend(
      id,
      actor,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )
  },
  { permission: { invitation: ['create'] } }
)
