import { broadcastCreateSchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, (raw) => broadcastCreateSchema.parse(raw ?? {}))
    setResponseStatus(event, 201)

    return services.broadcasts.create(body, actor)
  },
  {
    permission: { broadcast: ['create'] }
  }
)
