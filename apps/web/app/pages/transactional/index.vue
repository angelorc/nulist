<script setup lang="ts">
import type { TransactionalOverview, TransactionalWindow } from '#shared/schemas/transactional'

definePageMeta({ permission: { transactional: ['read'] } })

useSeoMeta({ title: 'Transactional' })

const NEW_TEMPLATE = '/templates?new=1&kind=transactional'
const REFRESH_MS = 30_000

const { can } = useOrganization()
const canReadApiKeys = computed(() => can({ apiKey: ['read'] }))
const canCreateApiKey = computed(() => can({ apiKey: ['create'] }))
const canCreateTemplate = computed(() => can({ template: ['create'] }))
const canReadLogs = computed(() => can({ log: ['read'] }))

/** Email logs matching a KPI, for members who may read them (the cards are not links otherwise). */
const logsUrl = (query: string) => (canReadLogs.value ? `/logs?${query}` : undefined)

// Lazy: navigation is instant and skeletons cover the first load; background refreshes keep the data on screen.
const { data, status, error, refresh } = useFetch<TransactionalOverview>(
  '/api/transactional/overview',
  { lazy: true }
)

const loading = computed(() => status.value === 'pending')
const initialLoading = computed(() => !data.value && !error.value)

// Keep recent emails and counts current while the tab is visible.
const visibility = useDocumentVisibility()

useIntervalFn(() => {
  if (visibility.value === 'visible' && !loading.value) refresh()
}, REFRESH_MS)

const deliveredRate = (w: TransactionalWindow) => (w.sent ? w.delivered / w.sent : 0)

/** The four 24h KPIs; their skeletons show until the first load (KpiCard `loading`). */
const kpis = computed(() => {
  const now = data.value?.last24h
  const before = data.value?.previous24h

  return [
    {
      key: 'sent',
      label: 'Sent (24h)',
      value: now?.sent,
      previous: before?.sent,
      format: 'number' as const,
      higherIsBetter: true,
      to: logsUrl('tab=emails&kind=transactional&period=24h'),
      hint: 'Emails handed to the provider in the last 24 hours.'
    },
    {
      key: 'delivered',
      label: 'Delivered',
      value: now && deliveredRate(now),
      previous: before && deliveredRate(before),
      format: 'percent' as const,
      higherIsBetter: true,
      to: logsUrl('tab=emails&kind=transactional&status=delivered&period=24h'),
      hint: 'Delivered divided by sent. Requires provider delivery events (Amazon SES).'
    },
    {
      key: 'bounced',
      label: 'Bounced (24h)',
      value: now?.bounced,
      previous: before?.bounced,
      format: 'number' as const,
      higherIsBetter: false,
      to: logsUrl('tab=emails&kind=transactional&status=bounced&period=24h'),
      hint: undefined
    },
    {
      key: 'failed',
      label: 'Failed (24h)',
      value: now?.failed,
      previous: before?.failed,
      format: 'number' as const,
      higherIsBetter: false,
      to: logsUrl('tab=emails&kind=transactional&status=failed&period=24h'),
      hint: 'Rejected by the provider or failed after every retry.'
    }
  ]
})

const siteUrl = String(useRuntimeConfig().public.siteUrl || useRequestURL().origin)
const { number } = useFormat()

defineShortcuts(
  computed(() => ({ n: canCreateTemplate.value ? () => navigateTo(NEW_TEMPLATE) : false }))
)
</script>

<template>
  <UDashboardPanel id="transactional">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #title>
          Transactional
          <span class="hidden lg:inline truncate text-sm font-normal text-muted">
            One-to-one emails your application sends through the REST API
          </span>
        </template>
        <template #right>
          <UButton
            v-if="canReadApiKeys"
            label="API keys"
            icon="i-lucide-key-round"
            variant="ghost"
            to="/settings/api-keys"
            class="hidden sm:inline-flex"
          />
          <UTooltip v-if="canCreateTemplate" text="New template" :kbds="['n']">
            <UButton label="New template" icon="i-lucide-plus" :to="NEW_TEMPLATE" />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !data"
        variant="error"
        appearance="outline"
        title="Couldn't load transactional email"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          :loading="loading"
          @click="() => refresh()"
        />
      </EmptyState>

      <template v-else>
        <section
          aria-label="Last 24 hours"
          :aria-busy="initialLoading"
          class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden shrink-0"
        >
          <KpiCard
            v-for="kpi in kpis"
            :key="kpi.key"
            class="bg-default"
            :label="kpi.label"
            :value="kpi.value"
            :previous="kpi.previous"
            :format="kpi.format"
            :higher-is-better="kpi.higherIsBetter"
            :hint="kpi.hint"
            :to="kpi.to"
            :loading="initialLoading"
          />
        </section>

        <div class="grid grid-cols-1 2xl:grid-cols-2 gap-6 shrink-0">
          <TransactionalTemplatesTable
            :templates="data?.templates ?? []"
            :loading="initialLoading"
          />
          <TransactionalRecentEmails :items="data?.recent ?? []" :loading="initialLoading" />
        </div>

        <DashboardSection
          title="Quickstart"
          description="Send an email from your server with one HTTP request"
          class="shrink-0"
        >
          <template #actions>
            <UButton
              v-if="canCreateApiKey"
              label="Create API key"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
              to="/settings/api-keys"
            />
            <span v-else class="text-xs text-muted">Ask an admin for an API key</span>
          </template>
          <TransactionalQuickstart :templates="data?.templates ?? []" :site-url="siteUrl" />
        </DashboardSection>

        <DashboardSection
          title="API reference"
          description="REST API v1. JSON in and out, authenticated with an API key."
          flush
          class="shrink-0"
        >
          <template v-if="canReadLogs" #actions>
            <UButton
              :label="data?.api.total ? `${number(data.api.total)} requests (24h)` : 'API logs'"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
              to="/logs?tab=api"
            />
          </template>
          <div class="px-4 pb-4 space-y-3">
            <p v-if="data?.api.total" class="text-[13px] text-muted tabular-nums">
              Last 24 hours: {{ number(data.api.total) }} requests,
              <span :class="data.api.errors ? 'text-error' : ''"
                >{{ number(data.api.errors) }} with errors</span
              ><template v-if="data.api.p50Ms !== null"
                >, median {{ number(data.api.p50Ms) }} ms</template
              >.
            </p>
            <TransactionalEndpointReference />
          </div>
        </DashboardSection>
      </template>
    </template>
  </UDashboardPanel>
</template>
