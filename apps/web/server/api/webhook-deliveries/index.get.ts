import { webhookDeliveriesQuerySchema } from '#shared/schemas/webhooks'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, webhookDeliveriesQuerySchema.parse)

    return services.webhookService.listDeliveries(query)
  },
  { permission: { webhook: ['read'] } }
)
