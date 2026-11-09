import { V1_PERMISSIONS, v1IdParamsSchema } from '#shared/schemas/v1'

/** GET /api/v1/lists/{id} — a mailing list with its subscriber counts. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)

    return services.listApi.get(id)
  },
  { permission: V1_PERMISSIONS.readList }
)
