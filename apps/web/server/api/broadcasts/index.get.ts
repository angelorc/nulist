import { broadcastListQuerySchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, broadcastListQuerySchema.parse)

    return services.broadcasts.list(query)
  },
  {
    permission: { broadcast: ['read'] }
  }
)
