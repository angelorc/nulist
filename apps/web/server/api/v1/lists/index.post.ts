import { V1_PERMISSIONS, v1ListCreateSchema } from '#shared/schemas/v1'

/** POST /api/v1/lists — create a mailing list. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const input = await readValidatedBody(event, v1ListCreateSchema.parse)
    const list = await services.listApi.create(input, actor)
    setResponseStatus(event, 201)

    return list
  },
  { permission: V1_PERMISSIONS.createList }
)
