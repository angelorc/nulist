import { V1_PERMISSIONS, v1TemplateCreateSchema } from '#shared/schemas/v1'

/** POST /api/v1/templates — create an MJML + Liquid template. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const input = await readValidatedBody(event, v1TemplateCreateSchema.parse)
    const template = await services.templateApi.create(input, actor)
    setResponseStatus(event, 201)

    return template
  },
  { permission: V1_PERMISSIONS.createTemplate }
)
