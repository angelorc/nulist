<script lang="ts">
import type { AvatarProps } from '@nuxt/ui'

/**
 * Avatar props of an organization: its logo, or its initials on an inverted square (never a
 * colored tile). Shared by `<AppOrganizationAvatar>` and the menus that take an `avatar` object
 * (UButton, UDropdownMenu items), so an organization looks the same everywhere.
 */
export function organizationAvatar(name: string, logo?: string | null): AvatarProps {
  return {
    src: logo ?? undefined,
    alt: name,
    class: 'rounded-md bg-inverted',
    ui: { image: 'rounded-md object-contain bg-default', fallback: 'text-inverted' }
  }
}
</script>

<script setup lang="ts">
/** An organization's logo, or its initials on a neutral square. */
const props = withDefaults(
  defineProps<{
    name: string
    logo?: string | null
    size?: AvatarProps['size']
  }>(),
  { logo: null, size: 'xs' }
)

const avatar = computed(() => organizationAvatar(props.name, props.logo))
</script>

<template>
  <UAvatar v-bind="avatar" :size="size" class="shrink-0" />
</template>
