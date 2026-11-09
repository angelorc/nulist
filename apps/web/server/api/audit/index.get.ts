import type { Paginated } from '#shared/types/domain'
import type { AuditLogItem } from '#shared/types/logs'
import { auditQuerySchema } from '#shared/schemas/logs'

/** The active organization's audit trail (the organization container's logger is scoped). */
export default defineApiHandler(
  async (event, { services }): Promise<Paginated<AuditLogItem>> => {
    const query = await getValidatedQuery(event, auditQuerySchema.parse)
    const page = await services.audit.list(query)

    return {
      ...page,
      items: page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))
    }
  },
  { permission: { audit: ['read'] } }
)
