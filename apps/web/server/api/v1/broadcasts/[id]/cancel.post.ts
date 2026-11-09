import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

/** POST /api/v1/broadcasts/{id}/cancel — stop a scheduled, sending or paused broadcast. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.broadcastApi.cancel(id, actor)
  },
  { permission: V1_PERMISSIONS.sendBroadcast }
)
