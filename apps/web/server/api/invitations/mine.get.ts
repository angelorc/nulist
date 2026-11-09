import type { ReceivedInvitation } from '#shared/schemas/members'
import { InvitationLookup } from '../../lib/organizations/InvitationLookup'

/** Pending invitations addressed to the signed-in user (works without an organization). */
export default defineSessionHandler((_event, { platform, user }): Promise<ReceivedInvitation[]> =>
  new InvitationLookup(platform.db).forUser(user.email)
)
