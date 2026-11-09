import type { Paginated } from '#shared/types/domain'
import type { EmailLogItem } from '#shared/types/logs'
import { emailLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<Paginated<EmailLogItem>> => {
    const query = await getValidatedQuery(event, emailLogQuerySchema.parse)

    return services.logs.emails(query)
  },
  { permission: { log: ['read'] } }
)
