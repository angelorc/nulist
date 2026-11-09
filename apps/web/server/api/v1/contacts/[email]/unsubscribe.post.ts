import { V1_PERMISSIONS, v1ContactParamsSchema, v1UnsubscribeSchema } from '#shared/schemas/v1'

/** POST /api/v1/contacts/{email}/unsubscribe — from one list (`listId`) or from every email. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { email } = await getValidatedRouterParams(event, v1ContactParamsSchema.parse, {
      decode: true
    })

    const { listId } = await readValidatedBody(event, v1UnsubscribeSchema.parse)

    return services.contactApi.unsubscribe(email, listId, actor)
  },
  { permission: V1_PERMISSIONS.unsubscribeContact }
)
