import { segmentCountSchema } from '#shared/schemas/segments'

/** Live count + preview for the rule builder (rules need not be saved). */
export default defineApiHandler(
  async (event, { services }) => {
    const { rules } = await readValidatedBody(event, segmentCountSchema.parse)

    const [count, preview] = await Promise.all([
      services.segments.count(rules),
      services.segments.preview(rules, 5)
    ])

    return { count, preview }
  },
  { permission: { segment: ['read'], contact: ['read'] } }
)
