import type { InboundEventStats } from '#shared/types/logs'
import { inboundEventQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<InboundEventStats> => {
    const query = await getValidatedQuery(event, inboundEventQuerySchema.parse)

    return services.logs.inboundStats(query)
  },
  { permission: { log: ['read'] } }
)
