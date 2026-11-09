import { V1_PERMISSIONS, v1BroadcastListQuerySchema } from '#shared/schemas/v1'

/** GET /api/v1/broadcasts — broadcasts with their delivery stats, newest first. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1BroadcastListQuerySchema.parse)

    return services.broadcastApi.list(query)
  },
  { permission: V1_PERMISSIONS.readBroadcast }
)
