import { templateListQuerySchema } from '#shared/schemas/templates'

export default defineApiHandler(
  async (event, { services }) => {
    const { preview, ...query } = await getValidatedQuery(event, templateListQuerySchema.parse)

    if (!preview) return services.templates.list(query)

    const previewer = services.templatePreviewer
    const rows = await services.templates.listWithHtml(query)

    return Promise.all(
      rows.map(async ({ html, ...row }) =>
        Object.assign(row, { previewHtml: await previewer.thumbnail(html) })
      )
    )
  },
  { permission: { template: ['read'] } }
)
