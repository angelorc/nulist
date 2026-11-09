import { z } from 'zod'
import { webhookEndpointUpdateSchema } from '#shared/schemas/webhooks'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, webhookEndpointUpdateSchema.parse)

    return services.webhookAdmin.updateEndpoint(id, body, actor)
  },
  { permission: { webhook: ['update'] } }
)
