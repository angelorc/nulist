import { z } from 'zod'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    const row = await services.webhookAdmin.rotateSecret(id, actor)

    return { id: row.id, secret: row.secret }
  },
  { permission: { webhook: ['update'] } }
)
