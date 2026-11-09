import { z } from 'zod'
import { contactUnsubscribeSchema } from '#shared/schemas/contacts'

/** `{ listId }` leaves one list; `{ listId: null }` unsubscribes from all emails. */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const { listId } = await readValidatedBody(event, contactUnsubscribeSchema.parse)
    await services.contacts.unsubscribe(id, listId, actor, `admin:${actor.label}`)

    return { ok: true }
  },
  { permission: { contact: ['update'] } }
)
