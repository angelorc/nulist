import { DomainError } from '../../lib/core/errors'

/**
 * Unknown v1 routes (or wrong methods) answer in the API error shape instead of
 * the HTML 404 page. Any valid key gets the 404 (no permission required); the
 * request is logged in the key's organization.
 */
const routeNotFound = defineApiKeyHandler(
  (event) => {
    const path = event.path.split('?')[0] ?? event.path
    throw new DomainError(
      `No endpoint matches ${event.method} ${path}. See Transactional → API reference in the dashboard.`,
      404,
      'route_not_found'
    )
  },
  { permission: {} }
)

export default defineEventHandler((event) => {
  // CORS preflight (headers come from the /api/v1/** route rule).
  if (event.method === 'OPTIONS') return sendNoContent(event, 204)

  return routeNotFound(event)
})
