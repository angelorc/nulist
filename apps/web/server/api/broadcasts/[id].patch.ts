import { z } from 'zod'
import { broadcastUpdateSchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, broadcastUpdateSchema.parse)

    return services.broadcasts.update(id, body, actor)
  },
  {
    permission: { broadcast: ['update'] }
  }
)
