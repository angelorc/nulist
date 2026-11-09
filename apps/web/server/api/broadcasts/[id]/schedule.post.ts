import { z } from 'zod'
import { broadcastScheduleSchema } from '#shared/schemas/broadcasts'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    const { scheduledAt } = await readValidatedBody(event, (body) =>
      broadcastScheduleSchema.parse(body ?? {})
    )

    return services.broadcasts.schedule(id, scheduledAt ?? null, actor)
  },
  {
    permission: { broadcast: ['send'] }
  }
)
