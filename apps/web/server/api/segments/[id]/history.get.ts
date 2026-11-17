import { z } from 'zod'
import { paginationSchema } from '#shared/schemas/pagination'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const query = await getValidatedQuery(event, paginationSchema.omit({ q: true }).parse)

    return services.segmentMemberships.history(id, query)
  },
  { permission: { segment: ['read'], contact: ['read'] } }
)
