<script setup lang="ts">
/**
 * One KPI tile (DESIGN.md §6): 13px muted label → 28px tabular value → delta vs the previous
 * period → optional sparkline. Tiles sit in a hairline grid
 * (`grid gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden`, tiles `bg-default`).
 * With `to` the whole tile is a link; `loading` renders its skeleton.
 *
 * <KpiCard label="Delivered" :value="9120" :previous="8800" :spark="series" to="/logs" />
 */
const props = withDefaults(
  defineProps<{
    label: string
    value?: number
    previous?: number
    format?: 'number' | 'percent'
    higherIsBetter?: boolean
    spark?: number[]
    /** Explains the metric (tooltip, and read by screen readers). */
    hint?: string
    to?: string
    loading?: boolean
  }>(),
  {
    value: 0,
    previous: undefined,
    format: 'number',
    higherIsBetter: true,
    spark: () => [],
    hint: undefined,
    to: undefined,
    loading: false
  }
)

const { number, percent } = useFormat()

const NuxtLink = resolveComponent('NuxtLink')

const display = computed(() =>
  props.format === 'percent' ? percent(props.value) : number(props.value)
)

const sparkPath = computed(() => {
  const s = props.spark

  if (s.length < 2) return ''
  const max = Math.max(...s, 1)

  return s
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (s.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(' ')
})
</script>

<template>
  <div v-if="loading" class="p-4 space-y-3" aria-busy="true">
    <USkeleton class="h-3.5 w-20" />
    <USkeleton class="h-8 w-24" />
    <USkeleton class="h-3 w-32" />
  </div>
  <component
    :is="to ? NuxtLink : 'div'"
    v-else
    :to="to"
    class="block p-4 transition-colors"
    :class="
      to &&
      'hover:bg-elevated/40 focus-visible:bg-elevated/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
    "
  >
    <div class="flex items-center gap-1.5">
      <p class="text-[13px] text-muted truncate">
        {{ label }}
      </p>
      <template v-if="hint">
        <UTooltip :text="hint">
          <UIcon name="i-lucide-info" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        </UTooltip>
        <span class="sr-only">{{ hint }}</span>
      </template>
    </div>
    <div class="mt-1.5 flex items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[28px] leading-8 font-semibold tracking-tight text-highlighted tabular-nums">
          {{ display }}
        </p>
        <div v-if="previous !== undefined" class="mt-1 flex items-center gap-1.5 text-xs">
          <KpiDelta :value="value" :previous="previous" :higher-is-better="higherIsBetter" />
          <span class="text-muted">vs previous period</span>
        </div>
      </div>
      <svg
        v-if="sparkPath"
        viewBox="0 0 100 32"
        class="h-8 w-24 shrink-0 text-primary"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          :d="sparkPath"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
  </component>
</template>
