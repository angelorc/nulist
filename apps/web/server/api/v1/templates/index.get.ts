import { V1_PERMISSIONS, v1TemplateListQuerySchema } from '#shared/schemas/v1'

/** GET /api/v1/templates — templates without their content, most recently updated first. */
export default defineApiKeyHandler(
  async (event, { services }) => {
    const query = await getValidatedQuery(event, v1TemplateListQuerySchema.parse)

    return services.templateApi.list(query)
  },
  { permission: V1_PERMISSIONS.readTemplate }
)
