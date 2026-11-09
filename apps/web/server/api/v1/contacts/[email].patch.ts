import { V1_PERMISSIONS, v1ContactParamsSchema, v1ContactUpdateSchema } from '#shared/schemas/v1'

/** PATCH /api/v1/contacts/{email} — update the profile, attributes or status of a contact. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { email } = await getValidatedRouterParams(event, v1ContactParamsSchema.parse, {
      decode: true
    })

    const input = await readValidatedBody(event, v1ContactUpdateSchema.parse)

    return services.contactApi.update(email, input, actor)
  },
  { permission: V1_PERMISSIONS.updateContact }
)
