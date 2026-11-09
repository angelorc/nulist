<script setup lang="ts">
/** HTTP status code with a dot colored by class (2xx success, 3xx info, 4xx warning, 5xx error). */
const props = defineProps<{ code: number }>()

const tone = computed(() => {
  if (props.code >= 500) return 'text-error'

  if (props.code >= 400) return 'text-warning'

  if (props.code >= 300) return 'text-info'

  return 'text-success'
})
</script>

<template>
  <span class="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums" :class="tone">
    <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    <span class="text-highlighted">{{ code }}</span>
  </span>
</template>
