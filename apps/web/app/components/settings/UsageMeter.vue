<script setup lang="ts">
/** One quota: label, "used / limit" and a progress bar that turns amber at 80% and red at 100%. */
const props = defineProps<{
  label: string
  used: number
  /** 0 = no limit. */
  limit: number
  unit?: string
}>()

const { number } = useFormat()
const ratio = computed(() => (props.limit > 0 ? props.used / props.limit : 0))

const color = computed(() =>
  ratio.value >= 1 ? 'error' : ratio.value >= 0.8 ? 'warning' : 'primary'
)

const suffix = computed(() => (props.unit ? ` ${props.unit}` : ''))
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-baseline justify-between gap-3 text-[13px]">
      <span class="text-default font-medium truncate">{{ label }}</span>
      <span class="tabular-nums text-muted shrink-0">
        <span class="text-highlighted">{{ number(used) }}{{ suffix }}</span>
        <template v-if="limit > 0"> / {{ number(limit) }}{{ suffix }}</template>
        <template v-else> · No limit</template>
      </span>
    </div>
    <UProgress
      v-if="limit > 0"
      :model-value="Math.min(used, limit)"
      :max="limit"
      :color="color"
      size="sm"
      :aria-label="`${label}: ${number(used)} of ${number(limit)}${suffix}`"
    />
    <div v-else class="h-1 rounded-full bg-elevated" aria-hidden="true" />
  </div>
</template>
