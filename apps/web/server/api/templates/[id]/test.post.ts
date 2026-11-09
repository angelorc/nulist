import { z } from 'zod'
import { templateTestSchema } from '#shared/schemas/templates'

/** Test sends need `template:update`: the editor saves pending changes before sending. */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
    const { to } = await readValidatedBody(event, templateTestSchema.parse)
    const template = await services.templates.findOrFail(id)

    return services.templateTestSender.send(template, to, actor)
  },
  { permission: { template: ['update'] } }
)
