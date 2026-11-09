import { templateCreateSchema } from '#shared/schemas/templates'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, templateCreateSchema.parse)

    return services.templates.create(body, actor)
  },
  { permission: { template: ['create'] } }
)
