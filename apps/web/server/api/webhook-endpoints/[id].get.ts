import { z } from 'zod'

/** Endpoint detail; the signing secret is only returned to members who may manage endpoints. */
export default defineApiHandler(
  async (event, { services, can }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)

    return services.webhookAdmin.getEndpoint(id, {
      includeSecret: can({ webhook: ['update'] })
    })
  },
  { permission: { webhook: ['read'] } }
)
