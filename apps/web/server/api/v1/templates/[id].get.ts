import { V1_PERMISSIONS, v1TemplateParamsSchema } from '#shared/schemas/v1'

/** GET /api/v1/templates/{id} — a template by id or slug, with its MJML and compiled HTML. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const { id } = await getValidatedRouterParams(event, v1TemplateParamsSchema.parse)

    return services.templateApi.get(id)
  },
  { permission: V1_PERMISSIONS.readTemplate }
)
