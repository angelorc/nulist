import { z } from 'zod'
import { segmentUpdateSchema } from '#shared/schemas/segments'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, segmentUpdateSchema.parse)

    return services.segments.update(id, body, actor)
  },
  { permission: { segment: ['update'] } }
)
