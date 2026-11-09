import { z } from 'zod'
import { broadcastRecipientsQuerySchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const query = await getValidatedQuery(event, broadcastRecipientsQuerySchema.parse)

    return services.broadcasts.recipients(id, query)
  },
  {
    permission: { broadcast: ['read'], contact: ['read'] }
  }
)
