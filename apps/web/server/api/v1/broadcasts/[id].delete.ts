import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

/** DELETE /api/v1/broadcasts/{id} — delete a draft, or a broadcast cancelled before sending started. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.broadcastApi.delete(id, actor)
  },
  { permission: V1_PERMISSIONS.deleteBroadcast }
)
