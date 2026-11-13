import type { AuditFacets } from '#shared/types/logs'
import { auditQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<AuditFacets> => {
    const query = await getValidatedQuery(event, auditQuerySchema.parse)

    return services.audit.facets(query)
  },
  { permission: { audit: ['read'] } }
)
