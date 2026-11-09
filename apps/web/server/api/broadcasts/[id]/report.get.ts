import { z } from 'zod'

export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    // 404 for a broadcast of another organization before any report query runs.
    await services.broadcasts.findOrFail(id)

    return services.analytics.broadcastReport(id)
  },
  {
    permission: { broadcast: ['read'] }
  }
)
