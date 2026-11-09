import { webhookEndpointInputSchema } from '#shared/schemas/webhooks'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, webhookEndpointInputSchema.parse)
    setResponseStatus(event, 201)

    return services.webhookAdmin.createEndpoint(body, actor)
  },
  { permission: { webhook: ['create'] } }
)
