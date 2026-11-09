import { z } from 'zod'
import type { InvitationDetails } from '#shared/schemas/members'
import { InvitationLookup } from '../../lib/organizations/InvitationLookup'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * What an invitee sees before signing in: organization, inviter, role and
 * state. The random invitation id is the secret; nothing else is exposed.
 */
export default definePublicHandler(async (event, { platform }): Promise<InvitationDetails> => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  return new InvitationLookup(platform.db).details(id)
})
