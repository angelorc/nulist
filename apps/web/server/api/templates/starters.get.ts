import { starterListQuerySchema } from '#shared/schemas/templates'

/** Ready-made emails for the "New template" gallery, previewed with sample values. */
export default defineApiHandler(
  async (event, { services }) => {
    const { kind } = await getValidatedQuery(event, starterListQuerySchema.parse)

    return services.starterGallery.list(kind)
  },
  { permission: { template: ['create'] } }
)
