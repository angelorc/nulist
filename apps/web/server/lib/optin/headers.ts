/** Responses to token-bearing recipient URLs: never cached, never indexed, no referrer leaks. */
export const RECIPIENT_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow'
} as const

/** The web view is untrusted-looking HTML on our origin: no scripts, no forms, framed only by us. */
export const WEB_VIEW_CSP = [
  "default-src 'none'",
  'img-src * data: blob:',
  "style-src 'unsafe-inline' *",
  'font-src * data:',
  'media-src *',
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'
].join('; ')
