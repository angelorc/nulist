import { z } from 'zod'
import { contactSubscribeSchema } from '#shared/schemas/contacts'

/** Admin action: may re-subscribe a member who previously unsubscribed from this list. */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const { listId, skipOptIn } = await readValidatedBody(event, contactSubscribeSchema.parse)

    const result = await services.contacts.subscribe(id, listId, actor, {
      skipOptIn,
      resubscribe: true
    })

    return { result }
  },
  { permission: { contact: ['update'] } }
)
