import { z } from 'zod'
import { invitationResponseSchema } from '#shared/schemas/members'
import type { ActiveOrganizationChange } from '#shared/schemas/members'
import { InvitationResponder } from '../../lib/organizations/InvitationLookup'
import { OrganizationAuthGateway } from '../../lib/organizations/OrganizationAuthGateway'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * Accepts or declines an invitation as the signed-in invitee (no active
 * organization needed). Accepting makes the organization active and forwards
 * the refreshed session cookie.
 */
export default defineSessionHandler(async (event): Promise<ActiveOrganizationChange> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { action } = await readValidatedBody(event, invitationResponseSchema.parse)

  const responder = new InvitationResponder(
    OrganizationAuthGateway.from(serverAuth(event).api, event.headers)
  )

  if (action === 'reject') {
    await responder.reject(id)

    return { organizationId: null }
  }

  const { organizationId, cookies } = await responder.accept(id)

  for (const cookie of cookies) appendResponseHeader(event, 'set-cookie', cookie)

  return { organizationId }
})
