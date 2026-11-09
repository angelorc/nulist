import { permissionsOf } from '#shared/auth/permissions'
import type { OrganizationContext } from '#shared/types/domain'

/** The active organization of the session, the member's role and permissions, and every organization of the user. */
export default defineSessionHandler(
  async (_event, { platform, user, sessionId, isInstanceAdmin }): Promise<OrganizationContext> => {
    const [active, organizations] = await Promise.all([
      platform.organizations.activeMembership(sessionId, user.id),
      platform.organizations.listForUser(user.id)
    ])

    const membership = active.status === 'ok' ? active.membership : null

    return {
      organization: membership
        ? { id: membership.id, name: membership.name, slug: membership.slug, logo: membership.logo }
        : null,
      role: membership?.role ?? null,
      permissions: permissionsOf(membership?.role),
      organizations,
      isInstanceAdmin
    }
  }
)
