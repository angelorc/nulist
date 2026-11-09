import { V1_PERMISSIONS, v1EmailParamsSchema } from '#shared/schemas/v1'

/** GET /api/v1/emails/{id} — status and delivery events of a transactional email. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1EmailParamsSchema.parse)

    return services.transactional.get(id)
  },
  { permission: V1_PERMISSIONS.readEmail }
)
