import { savedColorParamsSchema } from '#shared/schemas/saved-colors'

/** Removes a saved colour (`/api/templates/saved-colors/4f46e5`); returns the saved colours. */
export default defineApiHandler(
  async (event, { services }) => {
    const { color } = await getValidatedRouterParams(event, savedColorParamsSchema.parse)

    return services.savedColors.remove(color)
  },
  { permission: { template: ['update'] } }
)
