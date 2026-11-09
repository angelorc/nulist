import type { PageMeta } from '#app'
import type { PermissionRequest } from '#shared/auth/permissions'

declare module '#app' {
  interface PageMeta {
    /** What the member's role must allow to open the page (403 page otherwise). */
    permission?: PermissionRequest
  }
}

/** Dashboard pages (default layout) need an organization; the admin area does not. */
function needsOrganization(path: string, layout: PageMeta['layout']): boolean {
  return (layout === undefined || layout === 'default') && !path.startsWith('/admin')
}

/**
 * Loads the organization context for signed-in users, sends members without an
 * organization to the organization picker, and guards pages that declare
 * `definePageMeta({ permission: { settings: ['read'] } })`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = useUserSession()
  const organization = useOrganization()

  // Signed out: forget the previous user's organization.
  if (!loggedIn.value) return organization.clear()

  await organization.load()

  if (!organization.organization.value && needsOrganization(to.path, to.meta.layout))
    return navigateTo('/no-organization', { replace: true })

  const permission = to.meta.permission

  if (!permission || organization.can(permission)) return

  return abortNavigation(
    createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: "You don't have permission to view this page."
    })
  )
})
