import type { BroadcastReport } from '#shared/types/analytics'
import { uuidParamSchema } from '#shared/schemas/logs'

/** A broadcast of another organization is "not found" (the report query is scoped). */
export default defineApiHandler(
  async (event, { services }): Promise<BroadcastReport> => {
    const { id } = await getValidatedRouterParams(event, uuidParamSchema.parse)

    return services.analytics.broadcastReport(id)
  },
  { permission: { analytics: ['read'] } }
)
