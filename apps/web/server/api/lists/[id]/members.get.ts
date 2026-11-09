import { z } from 'zod'
import { listMembersQuerySchema } from '#shared/schemas/lists'

/** Members are contacts (emails, names): reading them also needs `contact:read`. */
export default defineApiHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const query = await getValidatedQuery(event, listMembersQuerySchema.parse)

    return services.lists.members(id, query)
  },
  { permission: { list: ['read'], contact: ['read'] } }
)
