<script setup lang="ts">
/**
 * Period-over-period change of a metric (DESIGN.md §6): arrow + signed percent, green or red by
 * the metric's good direction, muted when flat. Growth from zero reads "New"; without a previous
 * value nothing is rendered.
 *
 * <KpiDelta :value="bounces" :previous="previousBounces" :higher-is-better="false" />
 */
const props = withDefaults(
  defineProps<{
    value: number
    previous: number | null | undefined
    /** False for metrics where going up is bad (bounce rate, complaints). */
    higherIsBetter?: boolean
  }>(),
  { higherIsBetter: true }
)

const { signedPercent } = useFormat()

const trend = computed(() => Trend.between(props.value, props.previous))
const good = computed(() => trend.value.isGood(props.higherIsBetter))

const ICONS = {
  up: 'i-lucide-arrow-up-right',
  down: 'i-lucide-arrow-down-right',
  flat: 'i-lucide-minus'
} as const
</script>

<template>
  <span
    v-if="trend.direction !== null"
    class="inline-flex items-center gap-0.5 font-medium tabular-nums"
    :class="good === null ? 'text-muted' : good ? 'text-success' : 'text-error'"
  >
    <UIcon :name="ICONS[trend.direction]" class="size-3 shrink-0" aria-hidden="true" />
    {{ signedPercent(trend.ratio) }}
  </span>
  <span v-else-if="previous !== null && previous !== undefined" class="text-muted">New</span>
</template>
