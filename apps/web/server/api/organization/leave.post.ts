import type { ActiveOrganizationChange } from '#shared/schemas/members'
import { NoActiveOrganizationError, NotAMemberError } from '../../lib/core/errors'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'
import { SessionOrganization } from '../../lib/organizations/SessionOrganization'

/**
 * The signed-in user leaves the active organization (any member except the
 * last owner), then the session moves to their next organization, if any.
 */
export default defineSessionHandler(
  async (event, { platform, user, sessionId, actor }): Promise<ActiveOrganizationChange> => {
    const active = await platform.organizations.activeMembership(sessionId, user.id)

    if (active.status === 'none' || active.status === 'no_session')
      throw new NoActiveOrganizationError()

    if (active.status === 'not_member') throw new NotAMemberError()

    const organizationId = active.membership.id
    const gateway = OrganizationAuthGateway.from(serverAuth(event).api, event.headers)

    await platform
      .forOrganization(organizationId)
      .members.leave({ ...actor, organizationId }, gateway)

    const next = await new SessionOrganization(platform.organizations, gateway).fallback(user.id)

    for (const cookie of next.cookies) appendResponseHeader(event, 'set-cookie', cookie)

    return { organizationId: next.organizationId }
  }
)
