<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Status of a record with the color mapping of DESIGN.md §2 (shared/utils/status.ts) and a
 * leading dot, so state never relies on color alone. Never pick status colors by hand.
 *
 * <StatusBadge :status="contact.status" />
 * <StatusBadge status="active" label="Sending enabled" />
 */
const props = withDefaults(
  defineProps<{
    status: string | null | undefined
    /** Text to show instead of the status, as written (sentence case). */
    label?: string
    size?: Extract<BadgeProps['size'], 'xs' | 'sm' | 'md'>
  }>(),
  { label: undefined, size: 'sm' }
)

const color = computed(() => statusColor(props.status))

/** "hard_bounce" → "Hard bounce" (DESIGN.md §9: sentence case). */
const text = computed(() => {
  if (props.label !== undefined) return props.label

  const words = (props.status ?? 'unknown').replace(/_/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
})
</script>

<template>
  <UBadge :color="color" variant="subtle" :size="size" :label="text" class="gap-1.5">
    <template #leading>
      <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    </template>
  </UBadge>
</template>
