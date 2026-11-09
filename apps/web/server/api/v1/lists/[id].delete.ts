import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

/** DELETE /api/v1/lists/{id} — delete a list and its subscriptions (contacts are kept). */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.listApi.delete(id, actor)
  },
  { permission: V1_PERMISSIONS.deleteList }
)
