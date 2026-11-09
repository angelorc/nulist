import { broadcastEstimateSchema } from '#shared/schemas/broadcasts'
import type { BroadcastEstimate } from '#shared/types/broadcasts'

export default defineApiHandler(
  async (event, { services }): Promise<BroadcastEstimate> => {
    const { audience, topicId } = await readValidatedBody(event, broadcastEstimateSchema.parse)

    return { count: await services.broadcasts.estimate(audience, topicId) }
  },
  {
    permission: { broadcast: ['read'] }
  }
)
