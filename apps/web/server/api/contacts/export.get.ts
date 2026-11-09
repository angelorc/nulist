import { Readable } from 'node:stream'
import { contactExportQuerySchema } from '#shared/schemas/contacts'

/** CSV download of the contacts matching the list filters (or an explicit selection). */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const query = await getValidatedQuery(event, contactExportQuerySchema.parse)
    const csv = await services.contacts.exportCsv(query, actor)
    const date = new Date().toISOString().slice(0, 10)
    setResponseHeaders(event, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contacts-${date}.csv"`,
      'cache-control': 'no-store'
    })

    return sendStream(event, Readable.from(csv))
  },
  { permission: { contact: ['export'] } }
)
