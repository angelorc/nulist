<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { AnalyticsRange } from '#shared/types/analytics'
import type { Kpi } from '#shared/types/domain'
import type { RateStat } from '~/components/dashboard/RateStats.vue'

definePageMeta({ permission: { analytics: ['read'] } })

useSeoMeta({ title: 'Dashboard' })

interface RangeOption extends TabsItem {
  label: string
  value: AnalyticsRange
  /** Keyboard shortcut that selects the period. */
  key: string
}

const RANGES: RangeOption[] = [
  { label: '7 days', value: '7d', key: '1' },
  { label: '30 days', value: '30d', key: '2' },
  { label: '90 days', value: '90d', key: '3' }
]

const DEFAULT_RANGE: AnalyticsRange = '30d'

const PRIMARY_KPIS = new Set(['sent', 'delivery_rate', 'open_rate', 'click_rate'])
const SECONDARY_KPIS = new Set(['bounce_rate', 'complaint_rate', 'unsubscribes'])

/** The KPI hairline grid of DESIGN.md §6 (tiles are `bg-default`). */
const KPI_GRID =
  'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden shrink-0'

const route = useRoute()
const router = useRouter()
const { organization, can } = useOrganization()
const organizationId = computed(() => organization.value?.id ?? 'none')

/** The period lives in the URL (`?range=7d`) so it survives reloads and can be shared. */
const range = computed<AnalyticsRange>({
  get: () => RANGES.find((r) => r.value === route.query.range)?.value ?? DEFAULT_RANGE,
  set: (value) =>
    router.replace({
      query: { ...route.query, range: value === DEFAULT_RANGE ? undefined : value }
    })
})

/** Tab values come back as strings: only a known period is applied. */
function selectRange(value: string | number) {
  const option = RANGES.find((r) => r.value === value)

  if (option) range.value = option.value
}

const rangeDays = computed(() => Number.parseInt(range.value, 10))

// Keyed by organization so a switch never shows the previous organization's KPIs.
const { data, status, error, refresh } = await useFetch('/api/analytics/overview', {
  key: () => `analytics-overview:${organizationId.value}:${range.value}`,
  query: { range }
})

const loading = computed(() => status.value === 'pending')

/** Email logs filtered to what a KPI counts (only for members who can read logs). */
const KPI_LINKS = new Map([
  ['sent', '/logs?tab=emails'],
  ['bounce_rate', '/logs?tab=emails&status=bounced'],
  ['complaint_rate', '/logs?tab=emails&status=complained']
])

const KPI_HINTS = new Map([
  [
    'open_rate',
    'An estimate: Apple Mail Privacy Protection and image proxies load tracking pixels automatically. Clicks are the reliable engagement signal.'
  ],
  ['delivery_rate', 'Delivered divided by sent. Requires provider delivery events (Amazon SES).'],
  ['click_rate', 'Unique clicks divided by delivered emails.'],
  ['bounce_rate', 'Hard bounces divided by sent emails. Amazon SES reviews accounts at 5%.'],
  [
    'complaint_rate',
    'Spam complaints divided by sent emails. Amazon SES reviews accounts at 0.1%; Gmail enforces 0.3%.'
  ],
  ['unsubscribes', 'Contacts who unsubscribed from at least one list or through an email link.']
])

const canReadLogs = computed(() => can({ log: ['read'] }))
const canReadAudit = computed(() => can({ audit: ['read'] }))

const insightWidgets = computed(() => (canReadLogs.value ? 2 : 0) + (canReadAudit.value ? 1 : 0))

const kpis = computed(() =>
  (data.value?.kpis ?? []).map((kpi: Kpi): RateStat =>
    Object.assign({}, kpi, {
      label: kpi.key === 'open_rate' ? 'Open rate (est.)' : kpi.label,
      hint: KPI_HINTS.get(kpi.key),
      to: canReadLogs.value ? KPI_LINKS.get(kpi.key) : undefined
    })
  )
)

const primaryKpis = computed(() => kpis.value.filter((k) => PRIMARY_KPIS.has(k.key)))
const secondaryKpis = computed(() => kpis.value.filter((k) => SECONDARY_KPIS.has(k.key)))

/** Hiding the checklist is remembered per organization: each one has its own first steps. */
const dismissed = useLocalStorage(
  () => `nulist:onboarding-dismissed:${organizationId.value}`,
  false,
  { initOnMounted: true }
)

const showChecklist = computed(() => {
  const onboarding = data.value?.onboarding

  if (!onboarding || dismissed.value) return false
  const complete = Object.values(onboarding.steps).every(Boolean)

  return !complete && (!onboarding.hasSent || !onboarding.steps.broadcast)
})

defineShortcuts(
  Object.fromEntries(
    RANGES.map((option) => [
      option.key,
      () => {
        range.value = option.value
      }
    ])
  )
)
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <Can :permission="{ broadcast: ['create'] }">
            <UButton label="New broadcast" icon="i-lucide-plus" to="/broadcasts?new=1" />
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <UTooltip text="Reporting period" :kbds="RANGES.map((r) => r.key)">
            <UTabs
              :model-value="range"
              :items="RANGES"
              :content="false"
              size="xs"
              color="neutral"
              aria-label="Reporting period"
              @update:model-value="selectRange"
            />
          </UTooltip>
        </template>
        <template #right>
          <p class="hidden sm:block text-[13px] text-muted">
            Compared with the previous {{ rangeDays }} days
          </p>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !data"
        variant="error"
        appearance="outline"
        title="The dashboard could not be loaded"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          :loading="loading"
          @click="() => refresh()"
        />
      </EmptyState>

      <template v-else-if="data">
        <DashboardChecklist
          v-if="showChecklist"
          :steps="data.onboarding.steps"
          @dismiss="dismissed = true"
        />

        <section
          aria-label="Key metrics"
          :aria-busy="loading || undefined"
          :class="[KPI_GRID, 'transition-opacity', loading && 'opacity-60']"
        >
          <KpiCard
            v-for="kpi in primaryKpis"
            :key="kpi.key"
            class="bg-default"
            :label="kpi.label"
            :value="kpi.value"
            :previous="kpi.previous"
            :format="kpi.format"
            :higher-is-better="kpi.higherIsBetter"
            :spark="kpi.spark"
            :hint="kpi.hint"
            :to="kpi.to"
          />
        </section>

        <DashboardRateStats
          :items="secondaryKpis"
          class="shrink-0 transition-opacity"
          :class="loading && 'opacity-60'"
        />

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 shrink-0">
          <DashboardActivityChart :series="data.series" :loading="loading" class="lg:col-span-2" />
          <DashboardHealthCard :health="data.health" />
        </div>

        <div
          v-if="insightWidgets"
          class="grid grid-cols-1 gap-4 sm:gap-6 shrink-0"
          :class="insightWidgets > 2 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'"
        >
          <template v-if="canReadLogs">
            <DashboardPipelineHealth :range="range" />
            <DashboardDeliveryIssues />
          </template>
          <DashboardRecentActivity v-if="canReadAudit" />
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 shrink-0">
          <DashboardGrowthChart :growth="data.growth" :loading="loading" />
          <DashboardTopBroadcasts :items="data.topBroadcasts" :loading="loading" />
        </div>
      </template>

      <!-- First load: placeholders in the shape of the dashboard. -->
      <template v-else>
        <div :class="KPI_GRID" aria-busy="true">
          <KpiCard v-for="n in 4" :key="n" label="" loading class="bg-default" />
        </div>
        <DashboardRateStats :items="[]" loading class="shrink-0" />
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 shrink-0" aria-hidden="true">
          <USkeleton class="h-88 rounded-lg lg:col-span-2" />
          <USkeleton class="h-88 rounded-lg" />
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 shrink-0" aria-hidden="true">
          <USkeleton class="h-88 rounded-lg" />
          <USkeleton class="h-88 rounded-lg" />
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>
