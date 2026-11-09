import type { MemberDirectory } from '#shared/schemas/members'

/** Members of the active organization, with the owner count (last-owner lock). */
export default defineApiHandler(
  (_event, { services, user }): Promise<MemberDirectory> => services.members.list(user.id),
  { permission: { member: ['read'] } }
)
