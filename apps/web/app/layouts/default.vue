<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

/** `g` then a letter opens a page (DESIGN.md §5), advertised in the ⌘K palette. */
interface GoShortcut {
  key: string
  to: string
}

const GO_SHORTCUTS: readonly GoShortcut[] = [
  { key: 'd', to: '/' },
  { key: 'c', to: '/contacts' },
  { key: 'b', to: '/broadcasts' },
  { key: 't', to: '/templates' },
  { key: 'l', to: '/logs' }
]

interface ContactHits {
  items: { id: string; email: string; firstName: string | null; lastName: string | null }[]
}

const open = ref(false)
const { main, secondary, actions, flat, canOpen } = useNavigation()
const organization = useOrganization()
const route = useRoute()

// Without an organization only the admin area works (the permission middleware
// redirects on navigation; this covers leaving or losing the last one in place).
const missingOrganization = computed(
  () =>
    organization.loaded.value &&
    !organization.organization.value &&
    !route.path.startsWith('/admin')
)

watch(missingOrganization, (missing) => {
  if (missing) void navigateTo('/no-organization', { replace: true })
})

const searchTerm = ref('')
const canSearchContacts = computed(() => organization.can({ contact: ['read'] }))

// Only the debounced term drives the request, and only for members who may read contacts.
const contactQuery = useDebounce(
  computed(() => searchTerm.value.trim()),
  250
)

// refreshNuxtData() (organization switch) re-runs every handler, so the guard lives in it.
const {
  data: contactHits,
  status: searchStatus,
  execute: searchContacts
} = useAsyncData(
  'command-palette-contacts',
  (): Promise<ContactHits> =>
    contactQuery.value.length >= 2 && canSearchContacts.value
      ? $fetch<ContactHits>('/api/contacts', { query: { q: contactQuery.value, pageSize: 5 } })
      : Promise.resolve({ items: [] }),
  { immediate: false, server: false, default: (): ContactHits => ({ items: [] }) }
)

watch(contactQuery, () => {
  void searchContacts()
})

const switchableOrganizations = computed(() =>
  organization.organizations.value.filter(
    (membership) => membership.id !== organization.organization.value?.id
  )
)

/** The `g` shortcut keys of a page, shown next to it in the palette. */
function shortcutKbds(to: string): string[] | undefined {
  const shortcut = GO_SHORTCUTS.find((entry) => entry.to === to)

  return shortcut ? ['g', shortcut.key] : undefined
}

const destinations = computed(() =>
  flat.value.map((destination): CommandPaletteItem => ({
    id: destination.id,
    label: destination.label,
    icon: destination.icon,
    to: destination.to,
    kbds: shortcutKbds(destination.to)
  }))
)

const groups = computed<CommandPaletteGroup[]>(() => [
  { id: 'actions', label: 'Actions', items: actions.value },
  { id: 'navigation', label: 'Go to', items: destinations.value },
  {
    id: 'organizations',
    label: 'Organizations',
    items: switchableOrganizations.value.map((membership) => ({
      id: `organization-${membership.id}`,
      label: `Switch to ${membership.name}`,
      icon: 'i-lucide-arrow-left-right',
      onSelect: () => organization.switchTo(membership.id)
    }))
  },
  {
    id: 'contacts',
    label: 'Contacts',
    ignoreFilter: true,
    items:
      contactQuery.value.length < 2 || !canSearchContacts.value
        ? []
        : contactHits.value.items.map((contact) => ({
            id: contact.id,
            label: contact.email,
            suffix: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || undefined,
            icon: 'i-lucide-user',
            to: `/contacts/${contact.id}`
          }))
  }
])

const searchPlaceholder = computed(() =>
  canSearchContacts.value ? 'Search contacts, pages or actions…' : 'Search pages or actions…'
)

// Pages the member may not open get no shortcut at all.
defineShortcuts(
  computed(() =>
    Object.fromEntries(
      GO_SHORTCUTS.map(({ key, to }) => [
        `g-${key}`,
        canOpen(to) ? () => void navigateTo(to) : false
      ])
    )
  )
)
</script>

<template>
  <UDashboardGroup unit="rem" storage="local">
    <UDashboardSidebar
      id="main"
      v-model:open="open"
      collapsible
      resizable
      :default-size="15"
      :min-size="12"
      :max-size="20"
      class="bg-elevated/40"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <AppOrganizationSwitcher :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton
          :collapsed="collapsed"
          tooltip
          class="bg-transparent ring-default"
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="main"
          orientation="vertical"
          tooltip
          popover
          :ui="{ label: 'text-muted font-medium' }"
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="secondary"
          orientation="vertical"
          tooltip
          popover
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <AppUserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch
      v-model:search-term="searchTerm"
      :groups="groups"
      :loading="searchStatus === 'pending'"
      :placeholder="searchPlaceholder"
    />

    <slot />
  </UDashboardGroup>
</template>
