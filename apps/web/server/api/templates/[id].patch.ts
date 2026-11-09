import { z } from 'zod'
import { templateUpdateSchema } from '#shared/schemas/templates'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const body = await readValidatedBody(event, templateUpdateSchema.parse)

    return services.templates.update(id, body, actor)
  },
  { permission: { template: ['update'] } }
)
