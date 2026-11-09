import type { EmailLogDetail } from '#shared/types/logs'
import { uuidParamSchema } from '#shared/schemas/logs'

/** The preview is rendered with the active organization's settings (company footer). */
export default defineApiHandler(
  async (event, { services }): Promise<EmailLogDetail> => {
    const { id } = await getValidatedRouterParams(event, uuidParamSchema.parse)
    const detail = await services.logs.message(id)

    return services.messagePreview.apply(detail)
  },
  { permission: { log: ['read'] } }
)
