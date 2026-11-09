import { z } from 'zod'
import { contactUpdateSchema } from '#shared/schemas/contacts'

/** Profile, attributes and status (block, reactivate). */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, contactUpdateSchema.parse)

    return services.contacts.update(id, body, actor)
  },
  { permission: { contact: ['update'] } }
)
