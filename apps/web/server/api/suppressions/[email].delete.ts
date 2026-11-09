import { suppressionEmailParamsSchema } from '#shared/schemas/suppressions'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { email } = await getValidatedRouterParams(event, suppressionEmailParamsSchema.parse)

    return services.suppressionAdmin.remove(email, actor)
  },
  { permission: { suppression: ['delete'] } }
)
