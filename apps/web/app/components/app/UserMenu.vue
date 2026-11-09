<script setup lang="ts">
import type { AvatarProps, DropdownMenuItem } from '@nuxt/ui'

/** Sidebar footer: the signed-in user with their pages, the color mode and sign-out. */
defineProps<{ collapsed?: boolean }>()

type ColorModePreference = 'system' | 'light' | 'dark'

interface AppearanceOption {
  mode: ColorModePreference
  label: string
  icon: string
}

const APPEARANCE: readonly AppearanceOption[] = [
  { mode: 'system', label: 'System', icon: 'i-lucide-monitor' },
  { mode: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { mode: 'dark', label: 'Dark', icon: 'i-lucide-moon' }
]

const { user, signOut } = useUserSession()
const organization = useOrganization()
const colorMode = useColorMode()

const avatar = computed<AvatarProps>(() => ({
  src: user.value?.image ?? undefined,
  alt: user.value?.name ?? 'User'
}))

async function onSignOut() {
  await signOut({
    onSuccess: async () => {
      // The next user must never see this user's organization or cached data.
      organization.clear()
      clearNuxtData()
      await navigateTo('/login')
    }
  })
}

const items = computed<DropdownMenuItem[][]>(() => {
  const pages: DropdownMenuItem[] = []

  if (organization.can({ settings: ['read'] }))
    pages.push({ label: 'Settings', icon: 'i-lucide-settings', to: '/settings' })

  if (organization.can({ apiKey: ['read'] }))
    pages.push({ label: 'API keys', icon: 'i-lucide-key-round', to: '/settings/api-keys' })

  if (organization.isInstanceAdmin.value)
    pages.push({ label: 'Admin', icon: 'i-lucide-building', to: '/admin/organizations' })

  const groups: DropdownMenuItem[][] = [
    [
      {
        type: 'label',
        label: user.value?.name ?? '',
        description: user.value?.email,
        avatar: avatar.value
      }
    ]
  ]

  if (pages.length) groups.push(pages)

  groups.push(
    [
      {
        label: 'Appearance',
        icon: 'i-lucide-sun-moon',
        children: APPEARANCE.map((option): DropdownMenuItem => ({
          label: option.label,
          icon: option.icon,
          type: 'checkbox',
          checked: colorMode.preference === option.mode,
          onSelect(event: Event) {
            event.preventDefault()
            colorMode.preference = option.mode
          }
        }))
      }
    ],
    [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => void onSignOut() }]
  )

  return groups
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      :label="collapsed ? undefined : (user?.name ?? '')"
      :avatar="avatar"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      :aria-label="collapsed ? `Account: ${user?.name ?? 'User'}` : undefined"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
    />
  </UDropdownMenu>
</template>
