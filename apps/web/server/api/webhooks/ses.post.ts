import { RequestBodyLimit } from '../../lib/core/RequestBody'

const MAX_BODY_BYTES = 512 * 1024

/**
 * Amazon SES event destination (SNS HTTPS subscription), one per instance.
 * SNS posts JSON with `Content-Type: text/plain`, so the raw body is read and
 * verified (signature, certificate host, topic allow-list) before parsing.
 * The platform router applies each event in its message's organization.
 * Retryable failures answer 500 so SNS delivers the message again.
 */
export default definePublicHandler(async (event, { platform }) => {
  // The limit is enforced while streaming (also by server/middleware/body-limit.ts).
  const body = (await new RequestBodyLimit(MAX_BODY_BYTES).read(event)).toString('utf8')

  if (!body) throw createError({ statusCode: 400, statusMessage: 'Invalid SNS message' })

  const envelope = await platform.snsVerifier.verify(body)
  const result = await platform.sesEvents.handle(envelope)

  if (result.status === 'failed' && result.retryable) setResponseStatus(event, 500)

  return { status: result.status }
})
