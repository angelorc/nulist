import { V1_PERMISSIONS, v1IdParamsSchema, v1ListUpdateSchema } from '#shared/schemas/v1'

/** PATCH /api/v1/lists/{id} — rename a list or change its opt-in mode and visibility. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)
    const input = await readValidatedBody(event, v1ListUpdateSchema.parse)

    return services.listApi.update(id, input, actor)
  },
  { permission: V1_PERMISSIONS.updateList }
)
