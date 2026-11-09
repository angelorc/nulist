<script setup lang="ts">
import { format, startOfWeek } from 'date-fns'
import type { AudienceGrowthPoint } from '#shared/types/analytics'

const props = defineProps<{ growth: AudienceGrowthPoint[]; loading?: boolean }>()

/** Net growth keeps its sign: "+12", "-3", "0". */
const signedNumber = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' })

const { number, compact } = useFormat()

const localDay = (date: string) => new Date(`${date}T00:00:00`)

/** Daily bars up to ~6 weeks, weekly buckets beyond that so bars stay readable. */
const weekly = computed(() => props.growth.length > 45)

const rows = computed(() => {
  if (!weekly.value) {
    return props.growth.map((p) => ({
      label: format(localDay(p.date), 'd MMM'),
      subscribed: p.subscribed,
      unsubscribed: p.unsubscribed
    }))
  }

  const buckets = new Map<string, { label: string; subscribed: number; unsubscribed: number }>()

  for (const p of props.growth) {
    const week = startOfWeek(localDay(p.date), { weekStartsOn: 1 })
    const key = week.toISOString()

    const bucket = buckets.get(key) ?? {
      label: `Week of ${format(week, 'd MMM')}`,
      subscribed: 0,
      unsubscribed: 0
    }

    bucket.subscribed += p.subscribed
    bucket.unsubscribed += p.unsubscribed
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
})

const totals = computed(() =>
  props.growth.reduce(
    (acc, p) => ({
      subscribed: acc.subscribed + p.subscribed,
      unsubscribed: acc.unsubscribed + p.unsubscribed,
      newContacts: acc.newContacts + p.newContacts
    }),
    { subscribed: 0, unsubscribed: 0, newContacts: 0 }
  )
)

const net = computed(() => totals.value.subscribed - totals.value.unsubscribed)
const isEmpty = computed(() => totals.value.subscribed + totals.value.unsubscribed === 0)

const categories = [
  { key: 'subscribed' as const, label: 'Subscribed', color: 'primary' },
  { key: 'unsubscribed' as const, label: 'Unsubscribed', color: 'var(--ui-color-neutral-400)' }
]

const stats = computed(() => [
  { label: 'New contacts', value: number(totals.value.newContacts) },
  { label: 'Subscriptions', value: number(totals.value.subscribed) },
  { label: 'Unsubscribes', value: number(totals.value.unsubscribed) },
  { label: 'Net growth', value: signedNumber.format(net.value) }
])
</script>

<template>
  <DashboardSection
    title="Audience growth"
    :description="
      weekly
        ? 'Confirmed subscriptions vs unsubscribes per week'
        : 'Confirmed subscriptions vs unsubscribes per day'
    "
  >
    <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div v-for="stat in stats" :key="stat.label" class="min-w-0">
        <dt class="text-xs text-muted truncate">
          {{ stat.label }}
        </dt>
        <dd class="text-sm font-semibold text-highlighted tabular-nums">
          {{ stat.value }}
        </dd>
      </div>
    </dl>
    <div
      class="relative transition-opacity"
      :class="loading && 'opacity-60'"
      :aria-busy="loading || undefined"
    >
      <UChart
        type="bar"
        :data="rows"
        index="label"
        :categories="categories"
        :height="200"
        :format="compact"
        :aria-label="`Audience growth: ${number(totals.subscribed)} subscriptions and ${number(totals.unsubscribed)} unsubscribes, net ${number(net)}`"
      />
      <div
        v-if="isEmpty && !loading"
        class="absolute inset-0 grid place-items-center pointer-events-none"
      >
        <p class="text-[13px] text-muted bg-default/90 px-3 py-1.5 rounded-md ring ring-default">
          No subscriptions or unsubscribes in this period
        </p>
      </div>
    </div>
  </DashboardSection>
</template>
