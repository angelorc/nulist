import { fileListQuerySchema } from '#shared/schemas/files'

export default defineApiHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, fileListQuerySchema.parse)

    return services.files.list(query)
  },
  { permission: { file: ['read'] } }
)
