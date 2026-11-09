import { z } from 'zod'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    await services.segments.delete(id, actor)

    return { ok: true }
  },
  { permission: { segment: ['delete'] } }
)
