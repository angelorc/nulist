import { listInputSchema } from '#shared/schemas/lists'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, listInputSchema.parse)

    return services.lists.create(body, actor)
  },
  { permission: { list: ['create'] } }
)
