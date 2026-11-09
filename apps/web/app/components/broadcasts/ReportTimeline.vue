<script setup lang="ts">
import { format } from 'date-fns'
import type { BroadcastTimelinePoint } from '#shared/types/analytics'

/** Opens and clicks over time: hourly for the first 48h, then daily. */
const props = defineProps<{ timeline: BroadcastTimelinePoint[]; loading?: boolean }>()

const { compact, number } = useFormat()

const SERIES = [
  {
    key: 'opens',
    label: 'Opens',
    color: 'color-mix(in oklab, var(--ui-primary) 45%, var(--ui-bg))'
  },
  { key: 'clicks', label: 'Clicks', color: 'var(--ui-primary)' }
] as const

const hourly = computed(() => props.timeline.some((p) => p.granularity === 'hour'))

const rows = computed(() =>
  props.timeline.map((point) => ({
    label: format(
      new Date(point.date),
      point.granularity === 'hour'
        ? props.timeline.length > 24
          ? 'd MMM HH:mm'
          : 'HH:mm'
        : 'd MMM'
    ),
    opens: point.opens,
    clicks: point.clicks
  }))
)

const totals = computed(() => ({
  opens: props.timeline.reduce((sum, p) => sum + p.opens, 0),
  clicks: props.timeline.reduce((sum, p) => sum + p.clicks, 0)
}))

const isEmpty = computed(() => totals.value.opens + totals.value.clicks === 0)

const ariaLabel = computed(
  () =>
    `Engagement over time: ${number(totals.value.opens)} opens and ${number(totals.value.clicks)} clicks`
)
</script>

<template>
  <DashboardSection
    title="Engagement"
    :description="
      hourly ? 'Opens and clicks per hour, then per day after 48 hours' : 'Opens and clicks per day'
    "
  >
    <template #actions>
      <div class="flex items-center gap-3 text-[13px] text-muted">
        <span v-for="s in SERIES" :key="s.key" class="inline-flex items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            :style="{ backgroundColor: s.color }"
            aria-hidden="true"
          />
          {{ s.label }}
          <span class="tabular-nums text-highlighted">{{ number(totals[s.key]) }}</span>
        </span>
      </div>
    </template>

    <div
      class="relative transition-opacity"
      :class="{ 'opacity-60': loading && timeline.length > 0 }"
    >
      <USkeleton v-if="loading && !timeline.length" class="h-[240px] w-full" aria-busy="true" />
      <template v-else>
        <UChart
          v-if="rows.length > 1"
          type="area"
          :data="rows"
          index="label"
          :categories="SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color }))"
          curve="monotone"
          :legend="false"
          :height="240"
          :format="compact"
          :aria-label="ariaLabel"
          :ui="{
            base: '[&_stop:first-child]:[stop-opacity:0.15]! [&_stop:last-child]:[stop-opacity:0]!'
          }"
        />
        <div v-else class="h-[240px] rounded-md bg-elevated/40" aria-hidden="true" />
        <div
          v-if="isEmpty || rows.length < 2"
          class="absolute inset-0 grid place-items-center pointer-events-none"
        >
          <p class="text-[13px] text-muted bg-default/90 px-3 py-1.5 rounded-md ring ring-default">
            {{ isEmpty ? 'No opens or clicks yet' : 'Not enough data for a chart yet' }}
          </p>
        </div>
      </template>
    </div>
  </DashboardSection>
</template>
