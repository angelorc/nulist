import { invitationCreateSchema } from '#shared/schemas/members'
import type { PendingInvitation } from '#shared/schemas/members'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

/** Invites someone to the active organization; Better Auth sends the invitation email. */
export default defineApiHandler(
  async (event, { services }): Promise<PendingInvitation> => {
    const input = await readValidatedBody(event, invitationCreateSchema.parse)

    return services.invitations.invite(
      input,
      OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
    )
  },
  { permission: { invitation: ['create'] } }
)
