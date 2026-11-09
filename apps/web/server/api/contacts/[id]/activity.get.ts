import { z } from 'zod'
import { contactActivityQuerySchema } from '#shared/schemas/contacts'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const { limit } = await getValidatedQuery(event, contactActivityQuerySchema.parse)

    return services.contacts.activity(id, limit)
  },
  { permission: { contact: ['read'] } }
)
