import { idempotencyKeySchema, transactionalBatchSchema } from '#shared/schemas/transactional'
import { V1_PERMISSIONS } from '#shared/schemas/v1'

/** POST /api/v1/emails/batch — send up to 100 emails; validated as a whole before anything is queued. */
export default defineApiKeyHandler(
  async (event, { services, apiKey }) => {
    const header = getRequestHeader(event, 'idempotency-key')
    const idempotencyKey = header === undefined ? null : idempotencyKeySchema.parse(header)
    const { emails } = await readValidatedBody(event, transactionalBatchSchema.parse)

    const { batch, replayed } = await services.transactional.sendBatch(
      emails,
      apiKey,
      idempotencyKey
    )

    if (replayed) setResponseHeader(event, 'idempotent-replayed', 'true')
    setResponseStatus(event, replayed ? 200 : 202)

    return batch
  },
  { permission: V1_PERMISSIONS.sendEmail }
)
