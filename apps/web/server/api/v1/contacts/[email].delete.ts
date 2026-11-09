import { V1_PERMISSIONS, v1ContactParamsSchema } from '#shared/schemas/v1'

/** DELETE /api/v1/contacts/{email} — delete a contact and its subscriptions. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { email } = await getValidatedRouterParams(event, v1ContactParamsSchema.parse, {
      decode: true
    })

    return services.contactApi.delete(email, actor)
  },
  { permission: V1_PERMISSIONS.deleteContact }
)
