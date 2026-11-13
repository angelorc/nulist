<script lang="ts">
import type { LogStats, LogVolumePoint, LogWindowRange } from '#shared/types/logs'

export type OverviewTone = 'neutral' | 'success' | 'warning' | 'error' | 'info'

export interface OverviewTile {
  key: string
  label: string
  value: number | null
  display?: string
  tone?: OverviewTone
  hint?: string
  selectable?: boolean
}

export interface OverviewSeries {
  ok: string
  issues: string
  other?: string
}
</script>

<script setup lang="ts">
import { format, parseISO } from 'date-fns'

const props = withDefaults(
  defineProps<{
    tiles: OverviewTile[]
    stats: Pick<LogStats<string>, 'total' | 'volume' | 'bucket' | 'window'> | null
    series: OverviewSeries
    title: string
    loading?: boolean
  }>(),
  { loading: false }
)

const selected = defineModel<string | undefined>('selected')

const TONE_DOT: Record<OverviewTone, string> = {
  neutral: 'bg-(--ui-color-neutral-400)',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info'
}

const { number, compact, percent } = useFormat()

const WINDOW_LABEL = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days'
} as const

const total = computed(() => props.stats?.total ?? 0)

const refreshing = computed(() => props.loading && props.stats !== null)

function display(tile: OverviewTile): string {
  if (tile.display) return tile.display

  return tile.value === null ? '—' : number(tile.value)
}

function share(tile: OverviewTile): string | null {
  if (tile.value === null || !tile.selectable || !total.value || tile.key === 'all') return null

  return percent(tile.value / total.value)
}

function toggle(tile: OverviewTile) {
  if (!tile.selectable) return
  selected.value = tile.key === 'all' || selected.value === tile.key ? undefined : tile.key
}

function isActive(tile: OverviewTile): boolean {
  return tile.key === 'all' ? !selected.value : selected.value === tile.key
}

const label = (point: LogVolumePoint) =>
  props.stats?.bucket === 'hour'
    ? format(new Date(point.at), 'HH:mm')
    : format(new Date(`${point.at}T00:00:00`), 'd MMM')

const rows = computed(() =>
  (props.stats?.volume ?? []).map((point) => Object.assign({ label: label(point) }, point))
)

const categories = computed(() => [
  { key: 'ok' as const, label: props.series.ok, color: 'var(--ui-primary)' },
  ...(props.series.other
    ? [{ key: 'other' as const, label: props.series.other, color: 'var(--ui-color-neutral-400)' }]
    : []),
  { key: 'issues' as const, label: props.series.issues, color: 'var(--ui-error)' }
])

const volumeTotal = computed(() =>
  rows.value.reduce((sum, p) => sum + p.ok + p.issues + p.other, 0)
)

/** The UTC day of an instant, as a local date for formatting. */
const utcDay = (instant: number) => parseISO(new Date(instant).toISOString().slice(0, 10))

function rangeLabel(window: LogWindowRange): string {
  const start = utcDay(Date.parse(window.from))
  const end = utcDay(Date.parse(window.to) - 1)
  const thisYear = new Date().getFullYear()

  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`
  }

  const tail = end.getFullYear() === thisYear ? 'd MMM' : 'd MMM yyyy'

  if (start.getTime() >= end.getTime()) return format(start, tail)

  const head = start.getMonth() === end.getMonth() ? 'd' : 'd MMM'

  return `${format(start, head)} – ${format(end, tail)}`
}

const windowLabel = computed(() => {
  const window = props.stats?.window

  if (!window) return ''

  return window.period ? WINDOW_LABEL[window.period] : rangeLabel(window)
})

const emptyLabel = computed(() =>
  props.stats?.window.period ? `in the ${windowLabel.value}` : 'in this date range'
)
</script>

<template>
  <section
    :aria-label="title"
    :aria-busy="refreshing || undefined"
    class="shrink-0 rounded-lg ring ring-default overflow-hidden"
  >
    <div
      class="grid grid-cols-2 sm:grid-cols-3 gap-px bg-(--ui-border) border-b border-default"
      :class="tiles.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'"
    >
      <template v-for="tile in tiles" :key="tile.key">
        <UButton
          v-if="tile.selectable"
          variant="ghost"
          :aria-pressed="isActive(tile)"
          class="rounded-none bg-default px-4 py-3 flex-col items-start gap-1 min-w-0 hover:bg-elevated/50"
          :class="isActive(tile) && 'bg-elevated/60 shadow-[inset_0_-2px_0_var(--ui-primary)]'"
          @click="toggle(tile)"
        >
          <span class="flex items-center gap-1.5 text-[13px] font-normal text-muted min-w-0">
            <span
              v-if="tile.tone"
              class="size-1.5 shrink-0 rounded-full"
              :class="TONE_DOT[tile.tone]"
              aria-hidden="true"
            />
            <span class="truncate">{{ tile.label }}</span>
          </span>
          <span class="flex items-baseline gap-2 min-w-0">
            <USkeleton v-if="!stats" class="h-6 w-14" />
            <span v-else class="text-xl font-semibold text-highlighted tabular-nums">
              {{ display(tile) }}
            </span>
            <span v-if="share(tile)" class="text-xs text-muted tabular-nums">{{
              share(tile)
            }}</span>
          </span>
        </UButton>
        <div v-else class="bg-default px-4 py-3 flex flex-col gap-1 min-w-0">
          <span class="flex items-center gap-1.5 text-[13px] text-muted min-w-0">
            <span class="truncate">{{ tile.label }}</span>
            <template v-if="tile.hint">
              <UTooltip :text="tile.hint">
                <UIcon name="i-lucide-info" class="size-3.5 shrink-0" aria-hidden="true" />
              </UTooltip>
              <span class="sr-only">{{ tile.hint }}</span>
            </template>
          </span>
          <USkeleton v-if="!stats" class="h-6 w-14" />
          <span v-else class="text-xl font-semibold text-highlighted tabular-nums">
            {{ display(tile) }}
          </span>
        </div>
      </template>
    </div>

    <div class="px-4 pt-3 pb-2 bg-default">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p class="text-[13px] text-muted">
          <span class="text-highlighted font-medium">{{ title }}</span>
          <template v-if="stats"> · {{ windowLabel }} · {{ number(volumeTotal) }} total </template>
        </p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            v-for="c in categories"
            :key="c.key"
            class="inline-flex items-center gap-1.5 text-xs text-muted"
          >
            <span
              class="size-2 rounded-full"
              :style="{ backgroundColor: c.color }"
              aria-hidden="true"
            />
            {{ c.label }}
          </span>
        </div>
      </div>
      <div class="relative mt-1 transition-opacity" :class="refreshing && 'opacity-60'">
        <USkeleton v-if="!stats" class="h-24 w-full" />
        <UChart
          v-else
          type="bar"
          stacked
          :data="rows"
          index="label"
          :categories="categories"
          :legend="false"
          :y-axis="false"
          :grid="false"
          :height="96"
          :format="compact"
          :aria-label="`${title}, ${windowLabel}: ${number(volumeTotal)} in total`"
        />
        <div
          v-if="stats && !volumeTotal && !refreshing"
          class="absolute inset-0 grid place-items-center pointer-events-none"
        >
          <p class="text-[13px] text-muted bg-default/90 px-3 py-1.5 rounded-md ring ring-default">
            Nothing recorded {{ emptyLabel }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
