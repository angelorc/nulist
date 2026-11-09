import { z } from 'zod'
import { topicUpdateSchema } from '#shared/schemas/topics'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, topicUpdateSchema.parse)

    return services.topics.update(id, body, actor)
  },
  { permission: { topic: ['update'] } }
)
