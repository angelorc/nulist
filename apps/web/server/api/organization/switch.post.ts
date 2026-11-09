import { z } from 'zod'
import { permissionsOf } from '#shared/auth/permissions'
import type { OrganizationContext } from '#shared/types/domain'
import { NotAMemberError } from '../../lib/core/errors'
import { callAuth, organizationApi } from '../../lib/settings/auth/BetterAuthApi'

const bodySchema = z.object({ organizationId: z.uuid() })

/** Makes another organization of the user active (Better Auth `setActiveOrganization`). */
export default defineSessionHandler(
  async (event, { platform, user, isInstanceAdmin }): Promise<OrganizationContext> => {
    const { organizationId } = await readValidatedBody(event, bodySchema.parse)
    const membership = await platform.organizations.membership(user.id, organizationId)

    if (!membership) throw new NotAMemberError()

    const { headers } = await callAuth(() =>
      organizationApi(serverAuth(event).api).setActiveOrganization({
        body: { organizationId },
        headers: event.headers,
        returnHeaders: true
      })
    )

    // The session cookie cache carries the active organization: forward the refreshed cookie.
    for (const cookie of headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)

    return {
      organization: {
        id: membership.id,
        name: membership.name,
        slug: membership.slug,
        logo: membership.logo
      },
      role: membership.role,
      permissions: permissionsOf(membership.role),
      organizations: await platform.organizations.listForUser(user.id),
      isInstanceAdmin
    }
  }
)
