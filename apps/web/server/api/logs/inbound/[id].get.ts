import type { InboundEventDetail } from '#shared/types/logs'
import { uuidParamSchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<InboundEventDetail> => {
    const { id } = await getValidatedRouterParams(event, uuidParamSchema.parse)

    return services.logs.inboundEvent(id)
  },
  { permission: { log: ['read'] } }
)
