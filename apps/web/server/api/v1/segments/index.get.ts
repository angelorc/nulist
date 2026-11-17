import { V1_PERMISSIONS, v1PageQuerySchema } from '#shared/schemas/v1'

export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1PageQuerySchema.parse)

    return services.segmentApi.list(query)
  },
  { permission: V1_PERMISSIONS.readSegment }
)
