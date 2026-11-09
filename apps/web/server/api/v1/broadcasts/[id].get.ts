import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

/** GET /api/v1/broadcasts/{id} — a broadcast with its audience and sending progress. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.broadcastApi.get(id)
  },
  { permission: V1_PERMISSIONS.readBroadcast }
)
