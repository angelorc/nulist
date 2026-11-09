import { inboundEventsQuerySchema } from '#shared/schemas/webhooks'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, inboundEventsQuerySchema.parse)

    return services.inboundEvents.list(query)
  },
  { permission: { webhook: ['read'] } }
)
