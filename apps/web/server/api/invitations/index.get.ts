import type { PendingInvitation } from '#shared/schemas/members'

/** Pending invitations of the active organization (Better Auth shows them to inviters only). */
export default defineApiHandler(
  (_event, { services }): Promise<PendingInvitation[]> => services.invitations.list(),
  { permission: { invitation: ['create'] } }
)
