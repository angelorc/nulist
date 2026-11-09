import { topicInputSchema } from '#shared/schemas/topics'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, topicInputSchema.parse)

    return services.topics.create(body, actor)
  },
  { permission: { topic: ['create'] } }
)
