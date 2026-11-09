import { templatePreviewSchema } from '#shared/schemas/templates'

/** Pure render with sample data and the organization's company details (read-only editors need it). */
export default defineApiHandler(
  async (event, { services }) => {
    const body = await readValidatedBody(event, templatePreviewSchema.parse)

    return services.templatePreviewer.preview(body)
  },
  { permission: { template: ['read'] } }
)
