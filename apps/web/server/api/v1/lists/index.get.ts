import { V1_PERMISSIONS, v1PageQuerySchema } from '#shared/schemas/v1'

/** GET /api/v1/lists — mailing lists with their subscriber counts, newest first. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1PageQuerySchema.parse)

    return services.listApi.list(query)
  },
  { permission: V1_PERMISSIONS.readList }
)
