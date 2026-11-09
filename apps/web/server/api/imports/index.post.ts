import { importCreateSchema } from '#shared/schemas/imports'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, importCreateSchema.parse)
    const created = await services.imports.create(body, actor)
    setResponseStatus(event, 202)

    return created
  },
  { permission: { contact: ['import'] } }
)
