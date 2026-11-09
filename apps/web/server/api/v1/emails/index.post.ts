import { idempotencyKeySchema, transactionalEmailSchema } from '#shared/schemas/transactional'
import { V1_PERMISSIONS } from '#shared/schemas/v1'

/** POST /api/v1/emails — send one transactional email (template or raw HTML). */
export default defineApiKeyHandler(
  async (event, { services, apiKey }) => {
    const header = getRequestHeader(event, 'idempotency-key')
    const idempotencyKey = header === undefined ? null : idempotencyKeySchema.parse(header)
    const body = await readValidatedBody(event, transactionalEmailSchema.parse)

    const { email, replayed } = await services.transactional.send(
      { ...body, idempotencyKey },
      apiKey
    )

    if (replayed) setResponseHeader(event, 'idempotent-replayed', 'true')
    setResponseStatus(event, replayed ? 200 : 202)

    return email
  },
  { permission: V1_PERMISSIONS.sendEmail }
)
