import { importListQuerySchema } from '#shared/schemas/imports'

/** Import history (contacts readers may follow imports started by others). */
export default defineApiHandler(
  async (event, { services }) => {
    const { limit } = await getValidatedQuery(event, importListQuerySchema.parse)

    return services.imports.list(limit)
  },
  { permission: { contact: ['read'] } }
)
