<script setup lang="ts">
import { format } from 'date-fns'
import type { MetricPoint } from '#shared/types/domain'

type SeriesKey = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced'

interface SeriesDefinition {
  key: SeriesKey
  label: string
  color: string
}

const props = defineProps<{ series: MetricPoint[]; loading?: boolean }>()

/** One hue: funnel stages are tints of primary, sent is the neutral baseline, bounces are red. */
const SERIES: readonly SeriesDefinition[] = [
  { key: 'sent', label: 'Sent', color: 'var(--ui-color-neutral-400)' },
  {
    key: 'delivered',
    label: 'Delivered',
    color: 'color-mix(in oklab, var(--ui-primary) 40%, var(--ui-bg))'
  },
  {
    key: 'opened',
    label: 'Opened',
    color: 'color-mix(in oklab, var(--ui-primary) 70%, var(--ui-bg))'
  },
  { key: 'clicked', label: 'Clicked', color: 'var(--ui-primary)' },
  { key: 'bounced', label: 'Bounced', color: 'var(--ui-error)' }
]

const active = ref<SeriesKey[]>(['delivered', 'opened', 'clicked'])

function isActive(key: SeriesKey): boolean {
  return active.value.includes(key)
}

/** Shows or hides a series; the last visible series stays on. Keeps the legend order. */
function toggle(key: SeriesKey) {
  if (isActive(key)) {
    if (active.value.length > 1) active.value = active.value.filter((k) => k !== key)
  } else {
    active.value = SERIES.flatMap((s) => (s.key === key || isActive(s.key) ? [s.key] : []))
  }
}

const { compact, number } = useFormat()

/** `YYYY-MM-DD` (UTC day) as a local date for labels. */
const dayLabel = (date: string) => format(new Date(`${date}T00:00:00`), 'd MMM')

const rows = computed(() =>
  props.series.map((point) => Object.assign({ label: dayLabel(point.date) }, point))
)

const categories = computed(() =>
  SERIES.flatMap((s) => (isActive(s.key) ? [{ key: s.key, label: s.label, color: s.color }] : []))
)

const isEmpty = computed(() =>
  props.series.every((p) => p.sent + p.delivered + p.opened + p.clicked + p.bounced === 0)
)

const ariaLabel = computed(() => {
  const first = props.series[0]
  const last = props.series.at(-1)

  if (!first || !last) return 'Email activity chart'

  const totals = categories.value
    .map((c) => `${c.label} ${number(props.series.reduce((sum, p) => sum + p[c.key], 0))}`)
    .join(', ')

  return `Daily email activity from ${dayLabel(first.date)} to ${dayLabel(last.date)}: ${totals}`
})
</script>

<template>
  <DashboardSection title="Email activity" description="Unique messages per day">
    <template #actions>
      <div role="group" aria-label="Chart series" class="flex flex-wrap items-center gap-1">
        <UButton
          v-for="s in SERIES"
          :key="s.key"
          :label="s.label"
          size="sm"
          variant="ghost"
          :active="isActive(s.key)"
          active-variant="soft"
          :aria-pressed="isActive(s.key)"
          :class="!isActive(s.key) && 'text-muted'"
          @click="toggle(s.key)"
        >
          <template #leading>
            <span
              class="size-2 shrink-0 rounded-full transition-opacity"
              :class="!isActive(s.key) && 'opacity-40'"
              :style="{ backgroundColor: s.color }"
              aria-hidden="true"
            />
          </template>
        </UButton>
      </div>
    </template>

    <div
      class="relative transition-opacity"
      :class="loading && 'opacity-60'"
      :aria-busy="loading || undefined"
    >
      <UChart
        type="area"
        :data="rows"
        index="label"
        :categories="categories"
        curve="monotone"
        :legend="false"
        :height="260"
        :format="compact"
        :aria-label="ariaLabel"
        :ui="{
          base: '[&_stop:first-child]:[stop-opacity:0.15]! [&_stop:last-child]:[stop-opacity:0]!'
        }"
      />
      <div
        v-if="isEmpty && !loading"
        class="absolute inset-0 grid place-items-center pointer-events-none"
      >
        <p class="text-[13px] text-muted bg-default/90 px-3 py-1.5 rounded-md ring ring-default">
          No email activity in this period
        </p>
      </div>
    </div>
  </DashboardSection>
</template>
