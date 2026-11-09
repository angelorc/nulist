import { z } from 'zod'
import { broadcastTestSchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const { emails } = await readValidatedBody(event, broadcastTestSchema.parse)

    return services.broadcasts.sendTest(id, emails, actor)
  },
  {
    permission: { broadcast: ['send'] }
  }
)
