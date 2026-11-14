import type { EmailLogFacets } from '#shared/types/logs'
import { emailLogQuerySchema } from '#shared/schemas/logs'

export default defineApiHandler(
  async (event, { services }): Promise<EmailLogFacets> => {
    const query = await getValidatedQuery(event, emailLogQuerySchema.parse)

    return services.logs.emailFacets(query)
  },
  { permission: { log: ['read'] } }
)
