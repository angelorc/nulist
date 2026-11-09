import { V1_PERMISSIONS, v1TemplateParamsSchema, v1TemplateUpdateSchema } from '#shared/schemas/v1'

/** PATCH /api/v1/templates/{id} — update a template by id or slug (returns MJML warnings). */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1TemplateParamsSchema.parse)
    const input = await readValidatedBody(event, v1TemplateUpdateSchema.parse)

    return services.templateApi.update(id, input, actor)
  },
  { permission: V1_PERMISSIONS.updateTemplate }
)
