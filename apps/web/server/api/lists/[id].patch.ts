import { z } from 'zod'
import { listUpdateSchema } from '#shared/schemas/lists'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, listUpdateSchema.parse)

    return services.lists.update(id, body, actor)
  },
  { permission: { list: ['update'] } }
)
