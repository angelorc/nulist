import type { DashboardOverview } from '#shared/types/analytics'
import { analyticsQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<DashboardOverview> => {
    const query = await getValidatedQuery(event, analyticsQuerySchema.parse)

    return services.analytics.overview(query)
  },
  { permission: { analytics: ['read'] } }
)
