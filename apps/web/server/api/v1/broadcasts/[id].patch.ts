import { V1_PERMISSIONS, v1BroadcastUpdateSchema, v1IdParamsSchema } from '#shared/schemas/v1'

/** PATCH /api/v1/broadcasts/{id} — edit a draft (409 `invalid_state` once scheduled). */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)
    const input = await readValidatedBody(event, v1BroadcastUpdateSchema.parse)

    return services.broadcastApi.update(id, input, actor)
  },
  { permission: V1_PERMISSIONS.updateBroadcast }
)
