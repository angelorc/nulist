import { RECIPIENT_HEADERS } from '../../lib/optin/headers'

/** Opening the List-Unsubscribe URL in a browser never unsubscribes: it shows the preference center. */
export default defineEventHandler((event) => {
  setResponseHeaders(event, RECIPIENT_HEADERS)
  const token = getRouterParam(event, 'token', { decode: true }) ?? ''

  return sendRedirect(event, `/preferences/${encodeURIComponent(token)}`, 302)
})
