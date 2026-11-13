import type { ApiLogStats } from '#shared/types/logs'
import { apiLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<ApiLogStats> => {
    const query = await getValidatedQuery(event, apiLogQuerySchema.parse)

    return services.logs.apiStats(query)
  },
  { permission: { log: ['read'] } }
)
