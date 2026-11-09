<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { AdminOrganizationCreateModal } from '#components'
import { organizationAvatar } from '~/components/app/OrganizationAvatar.vue'

/**
 * Sidebar header: the active organization (logo or initials and name) with a
 * menu to switch organizations, open its settings and, for instance
 * administrators, create organizations.
 */
defineProps<{ collapsed?: boolean }>()

const { organization, organizations, isInstanceAdmin, can, switchTo, refresh } = useOrganization()

const createModal = useOverlay().create(AdminOrganizationCreateModal)

const { run: switchOrganization } = useApiAction((id: string) => switchTo(id), {
  error: 'Could not switch organization'
})

/** The create modal reports the outcome; switch to the new organization when the admin is in it. */
async function createOrganization() {
  const created = await createModal.open().result

  if (!created) return
  await refresh()

  if (organizations.value.some((membership) => membership.id === created.organization.id))
    await switchOrganization(created.organization.id)
}

const triggerLabel = computed(() => organization.value?.name ?? 'No organization')

const items = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []

  if (organizations.value.length) {
    groups.push([
      { type: 'label', label: 'Organizations' },
      ...organizations.value.map((membership): DropdownMenuItem => ({
        label: membership.name,
        avatar: organizationAvatar(membership.name, membership.logo),
        type: 'checkbox',
        checked: membership.id === organization.value?.id,
        onSelect(event: Event) {
          if (membership.id === organization.value?.id) return event.preventDefault()
          void switchOrganization(membership.id)
        }
      }))
    ])
  }

  const manage: DropdownMenuItem[] = []

  if (organization.value) {
    manage.push({
      label: 'Organization settings',
      icon: 'i-lucide-settings-2',
      to: '/settings/organization'
    })
  }

  if (organization.value && can({ member: ['read'] }))
    manage.push({ label: 'Members', icon: 'i-lucide-users', to: '/settings/members' })

  if (manage.length) groups.push(manage)

  if (isInstanceAdmin.value) {
    groups.push([
      { label: 'Create organization', icon: 'i-lucide-plus', onSelect: createOrganization },
      { label: 'All organizations', icon: 'i-lucide-building', to: '/admin/organizations' }
    ])
  }

  return groups
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width) min-w-56' }"
  >
    <UButton
      :label="collapsed ? undefined : triggerLabel"
      :avatar="organization ? organizationAvatar(organization.name, organization.logo) : undefined"
      :icon="organization ? undefined : 'i-lucide-building-2'"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      variant="ghost"
      block
      :square="collapsed"
      :aria-label="organization ? `Organization: ${organization.name}` : 'Choose an organization'"
      class="data-[state=open]:bg-elevated"
      :class="!collapsed && 'py-2'"
      :ui="{ label: 'font-semibold text-highlighted', trailingIcon: 'text-dimmed' }"
    />
  </UDropdownMenu>
</template>
