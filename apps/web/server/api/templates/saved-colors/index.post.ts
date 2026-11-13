import { savedColorInputSchema } from '#shared/schemas/saved-colors'

/** Saves a colour for every colour picker of the visual editor; returns the saved colours. */
export default defineApiHandler(
  async (event, { services }) => {
    const { color } = await readValidatedBody(event, savedColorInputSchema.parse)

    return services.savedColors.add(color)
  },
  { permission: { template: ['update'] } }
)
