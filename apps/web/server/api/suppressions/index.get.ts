import { suppressionsQuerySchema } from '#shared/schemas/suppressions'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, suppressionsQuerySchema.parse)

    return services.suppressionAdmin.list(query)
  },
  { permission: { suppression: ['read'] } }
)
