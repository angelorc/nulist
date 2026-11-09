import { grants } from '#shared/auth/permissions'
import type { PermissionRequest } from '#shared/auth/permissions'
import type { OrganizationContext } from '#shared/types/domain'

/** Context of a signed-out user (or before the first load). */
const EMPTY_CONTEXT: OrganizationContext = {
  organization: null,
  role: null,
  permissions: {},
  organizations: [],
  isInstanceAdmin: false
}

/**
 * The active organization, the signed-in member's role and permissions, and
 * the organization switcher. SSR-safe: loaded once per request (by the global
 * permission middleware) into shared state that hydrates on the client.
 *
 * ```ts
 * const { organization, can, switchTo } = useOrganization()
 * can({ contact: ['create'] })
 * ```
 */
export function useOrganization() {
  const context = useState<OrganizationContext | null>('organization', () => null)
  const requestFetch = useRequestFetch()

  const current = computed(() => context.value ?? EMPTY_CONTEXT)

  /** Loads the context unless it is already loaded (`force` reloads it). */
  async function load(force = false): Promise<OrganizationContext> {
    if (context.value && !force) return context.value

    try {
      context.value = await requestFetch<OrganizationContext>('/api/organization')
    } catch {
      context.value = null
    }

    return current.value
  }

  /** Whether the member's role allows every action in `request` in the active organization. */
  function can(request: PermissionRequest): boolean {
    return grants(current.value.permissions, request)
  }

  /** Makes another organization active, reloads every page's data and goes home. */
  async function switchTo(organizationId: string): Promise<void> {
    context.value = await $fetch<OrganizationContext>('/api/organization/switch', {
      method: 'POST',
      body: { organizationId }
    })
    await refreshNuxtData()
    await navigateTo('/')
  }

  /** Forgets the context (after sign-out). */
  function clear(): void {
    context.value = null
  }

  return {
    context: current,
    organization: computed(() => current.value.organization),
    role: computed(() => current.value.role),
    permissions: computed(() => current.value.permissions),
    organizations: computed(() => current.value.organizations),
    isInstanceAdmin: computed(() => current.value.isInstanceAdmin),
    loaded: computed(() => context.value !== null),
    load,
    refresh: () => load(true),
    can,
    switchTo,
    clear
  }
}
