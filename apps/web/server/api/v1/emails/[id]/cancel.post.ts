import { V1_PERMISSIONS, v1EmailParamsSchema } from '#shared/schemas/v1'

/** POST /api/v1/emails/{id}/cancel — cancel a scheduled email. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1EmailParamsSchema.parse)

    return services.transactional.cancel(id, actor)
  },
  { permission: V1_PERMISSIONS.cancelEmail }
)
