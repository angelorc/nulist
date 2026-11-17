import { z } from 'zod'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const memberships = await services.segments.memberships(id)

    return services.segmentMemberships.memberSince(id, memberships)
  },
  { permission: { contact: ['read'], segment: ['read'] } }
)
