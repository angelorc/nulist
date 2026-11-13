import type { EmailLogStats } from '#shared/types/logs'
import { emailLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<EmailLogStats> => {
    const query = await getValidatedQuery(event, emailLogQuerySchema.parse)

    return services.logs.emailStats(query)
  },
  { permission: { log: ['read'] } }
)
