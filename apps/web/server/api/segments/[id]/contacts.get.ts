import { z } from 'zod'
import { segmentContactsQuerySchema } from '#shared/schemas/segments'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const query = await getValidatedQuery(event, segmentContactsQuerySchema.parse)

    return services.segments.contacts(id, query)
  },
  { permission: { segment: ['read'], contact: ['read'] } }
)
