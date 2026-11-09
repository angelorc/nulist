import type { AuditLogItem } from '#shared/types/logs'
import { serialParamSchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<AuditLogItem> => {
    const { id } = await getValidatedRouterParams(event, serialParamSchema.parse)

    return services.logs.auditEntry(id)
  },
  { permission: { audit: ['read'] } }
)
