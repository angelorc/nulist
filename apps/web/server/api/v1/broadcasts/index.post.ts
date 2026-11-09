import { V1_PERMISSIONS, v1BroadcastCreateSchema } from '#shared/schemas/v1'

/** POST /api/v1/broadcasts — create a draft broadcast (every field is optional, so is the body). */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const input = await readValidatedBody(event, (body) =>
      v1BroadcastCreateSchema.parse(body ?? {})
    )

    const broadcast = await services.broadcastApi.create(input, actor)
    setResponseStatus(event, 201)

    return broadcast
  },
  { permission: V1_PERMISSIONS.createBroadcast }
)
