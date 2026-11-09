import { contactCreateSchema } from '#shared/schemas/contacts'

/** `listIds` must be lists of the active organization (404 otherwise). */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, contactCreateSchema.parse)
    const contact = await services.contacts.create(body, actor)
    setResponseStatus(event, 201)

    return contact
  },
  { permission: { contact: ['create'] } }
)
