import type { ApiLogFacets } from '#shared/types/logs'
import { apiLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<ApiLogFacets> => {
    const query = await getValidatedQuery(event, apiLogQuerySchema.parse)

    return services.logs.apiFacets(query)
  },
  { permission: { log: ['read'] } }
)
