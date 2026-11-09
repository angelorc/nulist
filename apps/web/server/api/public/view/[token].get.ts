import { recipientTokenParamsSchema } from '#shared/schemas/public'
import { RECIPIENT_HEADERS, WEB_VIEW_CSP } from '../../../lib/optin/headers'

/** The email as HTML, framed by /view/:token (rendered in the link's organization). */
export default definePublicHandler(async (event, { resolver }) => {
  setResponseHeaders(event, {
    ...RECIPIENT_HEADERS,
    'content-security-policy': WEB_VIEW_CSP,
    'x-content-type-options': 'nosniff'
  })
  const { token } = await getValidatedRouterParams(event, recipientTokenParamsSchema.parse)
  const { services } = await resolver.fromToken('web', token)

  const { html } = await services.webView.render(token)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')

  return html
})
