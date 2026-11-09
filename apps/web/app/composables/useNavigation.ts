import type { NavigationMenuItem } from '@nuxt/ui'
import type { PermissionRequest } from '#shared/auth/permissions'

/**
 * A navigation entry with the access it requires. The access metadata is
 * stripped before the entry reaches UNavigationMenu / UDashboardSearch.
 */
export interface NavEntry extends NavigationMenuItem {
  /** App-internal path (also the ⌘K destination id). */
  to?: string
  /** What the member's role must allow. Omitted: any member of the active organization. */
  permission?: PermissionRequest
  /** Instance administrators only (no organization needed). */
  instanceAdmin?: boolean
  children?: NavEntry[]
}

/** A ⌘K action ("New broadcast"), shown when the member may perform it. */
export interface NavAction {
  id: string
  label: string
  icon: string
  to: string
  permission: PermissionRequest
}

/** A ⌘K "Go to" entry. */
export interface NavDestination {
  id: string
  label: string
  icon?: string
  to: string
}

/** What the signed-in user may see: the active organization's permissions and the instance role. */
export interface NavigationAccess {
  hasOrganization: boolean
  isInstanceAdmin: boolean
  can(request: PermissionRequest): boolean
}

const MAIN: NavEntry[] = [
  {
    label: 'Dashboard',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
    exact: true,
    permission: { analytics: ['read'] }
  },
  { label: 'Audience', type: 'label' },
  { label: 'Contacts', icon: 'i-lucide-users', to: '/contacts', permission: { contact: ['read'] } },
  { label: 'Lists', icon: 'i-lucide-list', to: '/lists', permission: { list: ['read'] } },
  {
    label: 'Segments',
    icon: 'i-lucide-filter',
    to: '/segments',
    permission: { segment: ['read'] }
  },
  { label: 'Messaging', type: 'label' },
  {
    label: 'Broadcasts',
    icon: 'i-lucide-send',
    to: '/broadcasts',
    permission: { broadcast: ['read'] }
  },
  {
    label: 'Transactional',
    icon: 'i-lucide-zap',
    to: '/transactional',
    permission: { transactional: ['read'] }
  },
  {
    label: 'Templates',
    icon: 'i-lucide-layout-template',
    to: '/templates',
    permission: { template: ['read'] }
  },
  { label: 'Files', icon: 'i-lucide-image', to: '/files', permission: { file: ['read'] } },
  { label: 'Insights', type: 'label' },
  { label: 'Logs', icon: 'i-lucide-scroll-text', to: '/logs', permission: { log: ['read'] } },
  {
    label: 'Audit log',
    icon: 'i-lucide-shield-check',
    to: '/audit',
    permission: { audit: ['read'] }
  },
  { label: 'Admin', type: 'label' },
  {
    label: 'Organizations',
    icon: 'i-lucide-building',
    to: '/admin/organizations',
    instanceAdmin: true
  }
]

/** Settings pages: the sidebar's Settings children and the settings sub-navigation. */
const SETTINGS: NavEntry[] = [
  {
    label: 'General',
    icon: 'i-lucide-sliders-horizontal',
    to: '/settings',
    exact: true,
    permission: { settings: ['read'] }
  },
  { label: 'Organization', icon: 'i-lucide-building-2', to: '/settings/organization' },
  {
    label: 'Members',
    icon: 'i-lucide-users',
    to: '/settings/members',
    permission: { member: ['read'] }
  },
  {
    label: 'Sending',
    icon: 'i-lucide-send',
    to: '/settings/sending',
    permission: { settings: ['read'] }
  },
  {
    label: 'Domains',
    icon: 'i-lucide-globe',
    to: '/settings/domains',
    permission: { domain: ['read'] }
  },
  {
    label: 'Storage',
    icon: 'i-lucide-hard-drive',
    to: '/settings/storage',
    permission: { settings: ['read'] }
  },
  {
    label: 'Limits',
    icon: 'i-lucide-gauge',
    to: '/settings/limits',
    permission: { settings: ['read'] }
  },
  {
    label: 'Topics',
    icon: 'i-lucide-tags',
    to: '/settings/topics',
    permission: { topic: ['read'] }
  },
  {
    label: 'Suppressions',
    icon: 'i-lucide-ban',
    to: '/settings/suppressions',
    permission: { suppression: ['read'] }
  },
  {
    label: 'API keys',
    icon: 'i-lucide-key-round',
    to: '/settings/api-keys',
    permission: { apiKey: ['read'] }
  }
]

const SECONDARY: NavEntry[] = [
  {
    label: 'Webhooks',
    icon: 'i-lucide-webhook',
    to: '/webhooks',
    permission: { webhook: ['read'] }
  },
  { label: 'Settings', icon: 'i-lucide-settings', type: 'trigger', children: SETTINGS }
]

const ACTIONS: NavAction[] = [
  {
    id: 'new-broadcast',
    label: 'New broadcast',
    icon: 'i-lucide-send',
    to: '/broadcasts?new=1',
    permission: { broadcast: ['create'] }
  },
  {
    id: 'add-contact',
    label: 'Add contact',
    icon: 'i-lucide-user-plus',
    to: '/contacts?new=1',
    permission: { contact: ['create'] }
  },
  {
    id: 'import-contacts',
    label: 'Import contacts',
    icon: 'i-lucide-upload',
    to: '/contacts/import',
    permission: { contact: ['import'] }
  },
  {
    id: 'new-template',
    label: 'New template',
    icon: 'i-lucide-layout-template',
    to: '/templates?new=1',
    permission: { template: ['create'] }
  },
  {
    id: 'new-segment',
    label: 'New segment',
    icon: 'i-lucide-filter',
    to: '/segments/new',
    permission: { segment: ['create'] }
  }
]

/**
 * Filters navigation entries by what the signed-in user may open and turns
 * them into plain menu items: group labels and triggers whose entries are all
 * hidden disappear too.
 */
export class NavigationFilter {
  constructor(private readonly access: NavigationAccess) {}

  allows(entry: NavEntry): boolean {
    if (entry.instanceAdmin) return this.access.isInstanceAdmin

    if (!this.access.hasOrganization) return false

    return !entry.permission || this.access.can(entry.permission)
  }

  /** Visible menu items; a label is kept only when an entry under it is visible. */
  menu(entries: readonly NavEntry[]): NavigationMenuItem[] {
    const items: NavigationMenuItem[] = []
    let pendingLabel: NavEntry | null = null

    for (const entry of entries) {
      if (entry.type === 'label') {
        pendingLabel = entry
        continue
      }

      const item = this.item(entry)

      if (!item) continue

      if (pendingLabel) items.push({ label: pendingLabel.label, type: 'label' })
      pendingLabel = null
      items.push(item)
    }

    return items
  }

  /** Visible links of `entries` (children flattened), for the ⌘K palette and shortcuts. */
  destinations(entries: readonly NavEntry[], prefix?: string): NavDestination[] {
    return entries.flatMap((entry) => {
      if (entry.children) return this.destinations(entry.children, entry.label)

      if (entry.type === 'label' || !entry.to || !this.allows(entry)) return []

      const label = prefix ? `${prefix} · ${entry.label}` : (entry.label ?? entry.to)

      return [
        { id: entry.to, label, icon: prefix ? 'i-lucide-settings' : entry.icon, to: entry.to }
      ]
    })
  }

  actions(actions: readonly NavAction[]): NavAction[] {
    if (!this.access.hasOrganization) return []

    return actions.filter((action) => this.access.can(action.permission))
  }

  /** The menu item for an entry without access metadata, or null when it is hidden. */
  private item(entry: NavEntry): NavigationMenuItem | null {
    if (entry.children) {
      const children = this.menu(entry.children)
      const first = children[0]

      if (!first) return null

      return {
        label: entry.label,
        icon: entry.icon,
        type: entry.type,
        to: entry.to ?? first.to,
        defaultOpen: entry.defaultOpen,
        children
      }
    }

    if (!this.allows(entry)) return null

    return {
      label: entry.label,
      icon: entry.icon,
      to: entry.to,
      exact: entry.exact,
      badge: entry.badge
    }
  }
}

/**
 * Single source of truth for app navigation: the sidebar, the settings
 * sub-navigation, the ⌘K palette and keyboard shortcuts. Reactive: entries the
 * member's role cannot open (and the Admin group for non-administrators) are hidden.
 */
export function useNavigation() {
  const organization = useOrganization()

  const filter = computed(
    () =>
      new NavigationFilter({
        hasOrganization: organization.organization.value !== null,
        isInstanceAdmin: organization.isInstanceAdmin.value,
        can: organization.can
      })
  )

  const main = computed(() => filter.value.menu(MAIN))
  const secondary = computed(() => filter.value.menu(SECONDARY))
  const settings = computed(() => filter.value.menu(SETTINGS))
  const actions = computed(() => filter.value.actions(ACTIONS))

  const flat = computed(() => [
    ...filter.value.destinations(MAIN),
    ...filter.value.destinations(SECONDARY)
  ])

  /** Whether `to` is a page the user may open (keyboard shortcuts). */
  function canOpen(to: string): boolean {
    return flat.value.some((destination) => destination.to === to)
  }

  return { main, secondary, settings, actions, flat, canOpen }
}
