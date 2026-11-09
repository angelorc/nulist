import { PayloadTooLargeError, RequestBodyLimit } from '../lib/core/RequestBody'

/**
 * Body caps of the unauthenticated endpoints, enforced while the body streams
 * in (chunked requests carry no Content-Length): the SES/SNS webhook, public
 * forms and one-click unsubscribe. File uploads apply their own limit.
 */
const LIMITS: readonly (readonly [RegExp, RequestBodyLimit])[] = [
  [/^\/api\/webhooks\/ses\/?$/, new RequestBodyLimit(512 * 1024)],
  [/^\/api\/public\//, new RequestBodyLimit(64 * 1024)],
  [/^\/u\//, new RequestBodyLimit(16 * 1024)]
]

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  const limit = LIMITS.find(([pattern]) => pattern.test(path))?.[1]

  if (!limit) return

  try {
    await limit.read(event)
  } catch (cause) {
    if (cause instanceof PayloadTooLargeError)
      throw createError({ statusCode: 413, statusMessage: 'Payload too large' })
    throw cause
  }
})
