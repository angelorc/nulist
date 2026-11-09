import { z } from 'zod'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    return services.broadcasts.cancel(id, actor)
  },
  {
    permission: { broadcast: ['send'] }
  }
)
