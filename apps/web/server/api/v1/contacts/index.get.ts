import { V1_PERMISSIONS, v1ContactListQuerySchema } from '#shared/schemas/v1'

/** GET /api/v1/contacts — contacts, newest first (filters: q, status, listId; sort). */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1ContactListQuerySchema.parse)

    return services.contactApi.list(query)
  },
  { permission: V1_PERMISSIONS.readContact }
)
