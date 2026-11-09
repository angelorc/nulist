<script setup lang="ts">
/**
 * Floating action bar for the rows selected in a table (DESIGN.md §5), bottom-center.
 * Put compact ghost buttons (`size="sm"`) in the default slot; destructive ones last with
 * `color="error"`.
 *
 * <BulkBar :count="selectedIds.length" @clear="rowSelection = {}">…</BulkBar>
 */
withDefaults(defineProps<{ count: number; label?: string }>(), { label: 'Bulk actions' })

defineEmits<{ clear: [] }>()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2 scale-96"
    leave-active-class="transition duration-150 ease-out"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="count > 0"
      role="toolbar"
      :aria-label="label"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-lg bg-default ring ring-default shadow-lg px-2 py-1.5"
    >
      <span class="text-[13px] font-medium text-highlighted px-2 tabular-nums" aria-live="polite"
        >{{ count }} selected</span
      >
      <USeparator orientation="vertical" class="h-5" />
      <slot />
      <USeparator orientation="vertical" class="h-5" />
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Clear selection"
        @click="$emit('clear')"
      />
    </div>
  </Transition>
</template>
