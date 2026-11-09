import { suppressionInputSchema } from '#shared/schemas/suppressions'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, suppressionInputSchema.parse)
    setResponseStatus(event, 201)

    return services.suppressionAdmin.add(body.email, actor)
  },
  { permission: { suppression: ['create'] } }
)
