import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.segmentApi.get(id)
  },
  { permission: V1_PERMISSIONS.readSegment }
)
