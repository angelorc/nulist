<script lang="ts">
import type { Kpi } from '#shared/types/domain'

/** A secondary metric with its explanation and, for members who can read logs, a link. */
export interface RateStat extends Kpi {
  hint?: string
  to?: string
}
</script>

<script setup lang="ts">
/**
 * Compact secondary metrics strip (bounce, complaint, unsubscribes) in the KPI hairline grid.
 * Rates keep two decimals: a 0.08% complaint rate must not round to 0.1%. `loading` renders
 * `skeletons` placeholder tiles.
 */
const props = withDefaults(
  defineProps<{ items: RateStat[]; loading?: boolean; skeletons?: number }>(),
  { loading: false, skeletons: 3 }
)

const { number, precisePercent } = useFormat()
const NuxtLink = resolveComponent('NuxtLink')

function display(kpi: Kpi): string {
  return kpi.format === 'percent' ? precisePercent(kpi.value) : number(kpi.value)
}
</script>

<template>
  <div
    class="grid grid-cols-1 sm:grid-cols-3 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden"
    :aria-busy="loading || undefined"
  >
    <template v-if="loading">
      <div v-for="n in props.skeletons" :key="n" class="bg-default px-4 py-3 space-y-2">
        <USkeleton class="h-3.5 w-24" />
        <USkeleton class="h-6 w-16" />
      </div>
    </template>
    <component
      :is="row.to ? NuxtLink : 'div'"
      v-for="row in items"
      v-else
      :key="row.key"
      :to="row.to"
      class="bg-default px-4 py-3 flex items-center justify-between gap-3 min-w-0 transition-colors"
      :class="
        row.to &&
        'hover:bg-elevated/40 focus-visible:bg-elevated/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
      "
    >
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <p class="text-[13px] text-muted truncate">
            {{ row.label }}
          </p>
          <template v-if="row.hint">
            <UTooltip :text="row.hint">
              <UIcon name="i-lucide-info" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            </UTooltip>
            <span class="sr-only">{{ row.hint }}</span>
          </template>
        </div>
        <p class="text-lg font-semibold text-highlighted tabular-nums leading-7">
          {{ display(row) }}
        </p>
      </div>
      <div class="text-right text-xs shrink-0">
        <KpiDelta
          :value="row.value"
          :previous="row.previous"
          :higher-is-better="row.higherIsBetter"
        />
        <p class="text-muted">vs previous period</p>
      </div>
    </component>
  </div>
</template>
