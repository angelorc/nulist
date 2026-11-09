<script setup lang="ts">
/**
 * Confirmation dialog opened through `useConfirm()` (DESIGN.md §5): the title names the object,
 * the description states the consequence, the confirm label is the verb. `danger` turns the
 * confirm button red for destructive actions. Emits `close` with the answer.
 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }>(),
  { description: undefined, confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false }
)

const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template v-if="$slots.default" #body>
      <slot />
    </template>
    <template #footer>
      <UButton :label="cancelLabel" color="neutral" variant="ghost" @click="emit('close', false)" />
      <UButton
        :label="confirmLabel"
        :color="danger ? 'error' : 'neutral'"
        autofocus
        @click="emit('close', true)"
      />
    </template>
  </UModal>
</template>
