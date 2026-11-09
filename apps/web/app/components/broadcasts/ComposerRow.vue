<script setup lang="ts">
/**
 * One email-client style row of the composer: muted label on the left, inline controls on the
 * right. With `for` the label is a real `<label>` for that control; rows holding several controls
 * (audience chips, switches) label each control themselves.
 */
defineProps<{ label: string; for?: string; hint?: string }>()
</script>

<template>
  <div class="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 px-4 py-2.5">
    <component
      :is="$props.for ? 'label' : 'span'"
      :for="$props.for"
      class="sm:w-24 shrink-0 pt-1 sm:pt-1.5 text-[13px] text-muted"
    >
      {{ label }}
    </component>
    <div class="flex-1 min-w-0">
      <slot />
      <p v-if="hint" class="mt-1 text-xs text-muted">
        {{ hint }}
      </p>
    </div>
  </div>
</template>
