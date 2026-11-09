import { z } from 'zod'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    return services.broadcasts.get(id)
  },
  {
    permission: { broadcast: ['read'] }
  }
)
