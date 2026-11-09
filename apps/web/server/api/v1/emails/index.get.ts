import { V1_PERMISSIONS, v1EmailListQuerySchema } from '#shared/schemas/v1'

/** GET /api/v1/emails — transactional emails, newest first (filter: status). */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1EmailListQuerySchema.parse)

    return services.transactional.list(query)
  },
  { permission: V1_PERMISSIONS.readEmail }
)
