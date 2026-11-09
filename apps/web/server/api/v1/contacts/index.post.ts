import { V1_PERMISSIONS, v1ContactUpsertSchema } from '#shared/schemas/v1'

/** POST /api/v1/contacts — create or update a contact by email and subscribe it to lists. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const input = await readValidatedBody(event, v1ContactUpsertSchema.parse)
    const result = await services.contactApi.upsert(input, actor)
    setResponseStatus(event, result.created ? 201 : 200)

    return result
  },
  { permission: V1_PERMISSIONS.upsertContact }
)
