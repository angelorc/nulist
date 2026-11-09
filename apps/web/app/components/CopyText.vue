<script setup lang="ts">
/**
 * Inline mono value (ID, key, address) with a copy button that appears on hover or focus, and
 * stays visible on touch screens (DESIGN.md §5 "Code & IDs").
 *
 * <CopyText :value="message.id" />
 */
const props = withDefaults(
  defineProps<{
    value: string
    /** Text shown instead of the value (the full value stays in the tooltip and the clipboard). */
    display?: string
    truncate?: boolean
  }>(),
  { display: undefined, truncate: true }
)
</script>

<template>
  <span class="group inline-flex items-center gap-1 min-w-0 font-mono text-xs text-muted">
    <span :class="truncate && 'truncate'" :title="props.value">{{ display ?? value }}</span>
    <CopyButton
      :value="value"
      :label="display ?? value"
      class="-my-1 shrink-0 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100"
    />
  </span>
</template>
