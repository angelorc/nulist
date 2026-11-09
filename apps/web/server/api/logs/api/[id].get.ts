import type { ApiLogDetail } from '#shared/types/logs'
import { serialParamSchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<ApiLogDetail> => {
    const { id } = await getValidatedRouterParams(event, serialParamSchema.parse)

    return services.logs.apiLog(id)
  },
  { permission: { log: ['read'] } }
)
