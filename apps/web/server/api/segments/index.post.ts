import { segmentInputSchema } from '#shared/schemas/segments'

export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, segmentInputSchema.parse)

    return services.segments.create(body, actor)
  },
  { permission: { segment: ['create'] } }
)
