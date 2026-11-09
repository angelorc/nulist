import { V1_PERMISSIONS, v1ContactParamsSchema } from '#shared/schemas/v1'

/** GET /api/v1/contacts/{email} — a contact with its list subscriptions. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const { email } = await getValidatedRouterParams(event, v1ContactParamsSchema.parse, {
      decode: true
    })

    return services.contactApi.get(email)
  },
  { permission: V1_PERMISSIONS.readContact }
)
