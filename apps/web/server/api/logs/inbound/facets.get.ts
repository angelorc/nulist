import type { InboundEventFacets } from '#shared/types/logs'
import { inboundEventQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<InboundEventFacets> => {
    const query = await getValidatedQuery(event, inboundEventQuerySchema.parse)

    return services.logs.inboundFacets(query)
  },
  { permission: { log: ['read'] } }
)
