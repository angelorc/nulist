<script lang="ts">
/** Why the state is empty (DESIGN.md §5): it picks the icon unless `icon` is given. */
export type EmptyStateVariant = 'first-run' | 'no-results' | 'error' | 'forbidden'
</script>

<script setup lang="ts">
import type { ButtonProps, EmptyProps } from '@nuxt/ui'
import type { VNode } from 'vue'

/**
 * Empty, no-results, error and no-permission states, built on UEmpty.
 * Actions go in the default slot (or `actions`): first-run → the primary CTA,
 * no-results → "Clear filters", error → "Retry".
 *
 * <EmptyState variant="no-results" title="No contacts match your filters">
 *   <UButton label="Clear filters" color="neutral" variant="outline" @click="clearFilters" />
 * </EmptyState>
 */
const props = withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    /** `forbidden`: the member's role does not allow this (403). */
    variant?: EmptyStateVariant
    /** Surface: `naked` on a page or in a card, `outline` where a table or list would stand. */
    appearance?: EmptyProps['variant']
    /** Buttons rendered when the default slot is not used. */
    actions?: ButtonProps[]
    /** Less vertical room, for states inside cards, sections and overlays. */
    compact?: boolean
  }>(),
  {
    icon: 'i-lucide-inbox',
    description: undefined,
    variant: 'first-run',
    appearance: 'naked',
    actions: undefined,
    compact: false
  }
)

defineSlots<{ default?: () => VNode[] }>()

const VARIANT_ICONS: Partial<Record<EmptyStateVariant, string>> = {
  error: 'i-lucide-triangle-alert',
  'no-results': 'i-lucide-search-x',
  forbidden: 'i-lucide-lock'
}

const iconName = computed(() => VARIANT_ICONS[props.variant] ?? props.icon)

/** Vertical room at every breakpoint (UEmpty pads responsively). */
const rootUi = computed(() =>
  props.compact ? 'gap-3 py-8 sm:py-8 lg:py-8' : 'gap-3 py-16 sm:py-16 lg:py-16'
)
</script>

<template>
  <UEmpty
    :as="{ root: 'div', title: 'p' }"
    :icon="iconName"
    :title="title"
    :description="description"
    :actions="actions"
    :variant="appearance"
    size="md"
    :ui="{ root: rootUi, title: 'text-sm', description: 'text-sm' }"
  >
    <template v-if="$slots.default" #actions>
      <slot />
    </template>
  </UEmpty>
</template>
