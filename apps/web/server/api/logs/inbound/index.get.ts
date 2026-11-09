import type { Paginated } from '#shared/types/domain'
import type { InboundEventItem } from '#shared/types/logs'
import { inboundEventQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<Paginated<InboundEventItem>> => {
    const query = await getValidatedQuery(event, inboundEventQuerySchema.parse)

    return services.logs.inboundEvents(query)
  },
  { permission: { log: ['read'] } }
)
