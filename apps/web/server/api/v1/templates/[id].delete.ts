import { V1_PERMISSIONS, v1TemplateParamsSchema } from '#shared/schemas/v1'

/** DELETE /api/v1/templates/{id} — delete a template no active broadcast uses. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1TemplateParamsSchema.parse)

    return services.templateApi.delete(id, actor)
  },
  { permission: V1_PERMISSIONS.deleteTemplate }
)
