import { z } from 'zod'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    return services.contacts.get(id)
  },
  { permission: { contact: ['read'] } }
)
