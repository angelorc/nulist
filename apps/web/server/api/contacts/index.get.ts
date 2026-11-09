import { contactListQuerySchema } from '#shared/schemas/contacts'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, contactListQuerySchema.parse)

    return services.contacts.list(query)
  },
  { permission: { contact: ['read'] } }
)
