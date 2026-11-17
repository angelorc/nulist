import { V1_PERMISSIONS, v1IdParamsSchema, v1SegmentContactsQuerySchema } from '#shared/schemas/v1'

export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)
    const query = await getValidatedQuery(event, v1SegmentContactsQuerySchema.parse)

    return services.segmentApi.contacts(id, query)
  },
  { permission: V1_PERMISSIONS.readSegmentContacts }
)
