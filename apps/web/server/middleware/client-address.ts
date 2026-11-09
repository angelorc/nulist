import { CLIENT_IP_HEADER } from '../lib/security/ClientAddress'

/**
 * Resolves the client address once per request: the socket peer, or the
 * X-Forwarded-For hop behind trusted proxies (MLIST_TRUSTED_PROXIES). h3's
 * getRequestIP reads `event.context.clientAddress`; Better Auth reads the
 * header, which always replaces whatever the client sent.
 */
export default defineEventHandler((event) => {
  const address = useServices().clientAddress.resolve(
    event.node.req.socket?.remoteAddress,
    getRequestHeader(event, 'x-forwarded-for')
  )

  event.context.clientAddress = address ?? undefined
  event.node.req.headers[CLIENT_IP_HEADER] = address ?? ''
  event.headers.set(CLIENT_IP_HEADER, address ?? '')
})
