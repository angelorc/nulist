import type { Paginated } from '#shared/types/domain'
import type { ApiLogItem } from '#shared/types/logs'
import { apiLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<Paginated<ApiLogItem>> => {
    const query = await getValidatedQuery(event, apiLogQuerySchema.parse)

    return services.logs.apiLogs(query)
  },
  { permission: { log: ['read'] } }
)
