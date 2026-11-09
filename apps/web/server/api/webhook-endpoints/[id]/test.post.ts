import { z } from 'zod'

/** Queues a signed test event to the endpoint (creates a delivery and calls the receiver). */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    return services.webhookAdmin.sendTest(id, actor)
  },
  { permission: { webhook: ['update'] } }
)
