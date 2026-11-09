import type { H3Event } from 'h3'
import { DomainError, NotFoundError } from '../../lib/core/errors'
import type { OrganizationContainer } from '../../lib/core/OrganizationContainer'
import { RECIPIENT_HEADERS } from '../../lib/optin/headers'

const TOKEN_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/

/**
 * Reads (and tolerates) the RFC 8058 body: `List-Unsubscribe=One-Click` sent as
 * application/x-www-form-urlencoded or multipart/form-data. Some clients send none.
 */
async function isOneClickBody(event: H3Event): Promise<boolean> {
  try {
    const type = getRequestHeader(event, 'content-type') ?? ''

    if (type.includes('multipart/form-data')) {
      const parts = await readMultipartFormData(event)

      return (
        parts?.some(
          (part) =>
            part.name === 'List-Unsubscribe' && part.data.toString('utf8').trim() === 'One-Click'
        ) ?? false
      )
    }

    const raw = await readRawBody(event, 'utf8')

    return new URLSearchParams(raw ?? '').get('List-Unsubscribe') === 'One-Click'
  } catch {
    return false
  }
}

/**
 * The services of the organization the token was signed for (claim `o`, or the
 * contact of an older token). Null when a validly signed token's organization
 * can't be found anymore (deleted contact): there is nothing left to unsubscribe.
 */
async function organizationOf(token: string): Promise<OrganizationContainer | null> {
  try {
    return (await useServices().publicContext.fromToken('unsubscribe', token)).services
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

/**
 * RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). Unauthenticated, cookie-less,
 * never redirects, idempotent: always 200 once the token is valid.
 */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { ...RECIPIENT_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
  const token = getRouterParam(event, 'token', { decode: true }) ?? ''
  const oneClick = await isOneClickBody(event)

  if (!TOKEN_PATTERN.test(token)) {
    setResponseStatus(event, 400)

    return 'This unsubscribe link is invalid.'
  }

  try {
    const services = await organizationOf(token)

    if (services) {
      const actor = requestActor(
        event,
        {
          type: 'system',
          id: null,
          label: oneClick ? 'One-click unsubscribe' : 'Unsubscribe link'
        },
        services.organizationId
      )

      await services.preferences.oneClickUnsubscribe(token, actor)
    }

    return 'You have been unsubscribed.'
  } catch (error) {
    if (error instanceof DomainError && error.status < 500) {
      setResponseStatus(event, 400)

      return 'This unsubscribe link is invalid.'
    }

    console.error('[unsubscribe] one-click request failed', error)
    setResponseStatus(event, 500)

    return 'Something went wrong. Please try again later.'
  }
})
