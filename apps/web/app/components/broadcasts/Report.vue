<script setup lang="ts">
import type { ButtonProps, DropdownMenuItem, TabsItem } from '@nuxt/ui'
import type { BroadcastReport } from '#shared/types/analytics'
import type { BroadcastDetail, BroadcastDto, BroadcastPreview } from '#shared/types/broadcasts'

type ReportTab = 'overview' | 'recipients' | 'content'

/**
 * Report view of a broadcast that left the composer: live progress and controls
 * while sending, then engagement KPIs, timeline, links, domains and recipients.
 * Sending controls, duplicate, delete and links to other areas follow the
 * member's role.
 */
const props = defineProps<{ broadcast: BroadcastDetail }>()
const emit = defineEmits<{ changed: [] }>()

const { can } = useOrganization()
const canSend = computed(() => can({ broadcast: ['send'] }))
const canCreate = computed(() => can({ broadcast: ['create'] }))
const canDelete = computed(() => can({ broadcast: ['delete'] }))
const canReadAudit = computed(() => can({ audit: ['read'] }))

/** The recipients tab lists contact emails and names. */
const canReadRecipients = computed(() => can({ contact: ['read'] }))

const id = props.broadcast.id
const { number, percent, relative } = useFormat()
const now = useRelativeNow()
const confirm = useConfirm()

useSeoMeta({ title: () => props.broadcast.name || 'Broadcast' })

const status = computed(() => props.broadcast.status)

const live = computed(
  () => status.value === 'sending' || status.value === 'paused' || status.value === 'scheduled'
)

// Report data -------------------------------------------------------------------
const reportUrl: string = `/api/broadcasts/${id}/report`

const {
  data: report,
  status: reportStatus,
  error: reportError,
  refresh: refreshReport
} = useFetch<BroadcastReport>(reportUrl, {
  lazy: true,
  server: false
})

/** `idle` counts as loading so the server render (no fetch) matches the first client render. */
const reportLoading = computed(() => !report.value && reportStatus.value !== 'error')
const reportRefreshing = computed(() => reportLoading.value || reportStatus.value === 'pending')

const { pause: stopReportPoll, resume: startReportPoll } = useIntervalFn(
  () => void refreshReport(),
  10_000,
  { immediate: false }
)

watch(live, (value) => (value ? startReportPoll() : stopReportPoll()), { immediate: true })

/** One last refresh when sending finishes so the KPIs match the final counts. */
watch(status, (next, previous) => {
  if (next !== previous) void refreshReport()
})

// KPIs --------------------------------------------------------------------------
interface Kpi {
  key: string
  label: string
  value: number
  format: 'number' | 'percent'
  hint?: string
}

const kpis = computed<Kpi[]>(() => {
  const r = report.value
  const totals = r?.totals
  const rates = r?.rates
  const recipients = totals?.recipients ?? props.broadcast.progress.recipients

  return [
    {
      key: 'recipients',
      label: 'Recipients',
      value: recipients,
      format: 'number',
      hint: `${number(totals?.sent ?? props.broadcast.progress.sent)} handed to the provider`
    },
    {
      key: 'delivered',
      label: 'Delivered',
      value: rates?.delivery ?? 0,
      format: 'percent',
      hint: `${number(totals?.delivered)} delivered`
    },
    {
      key: 'open',
      label: 'Open rate',
      value: rates?.open ?? 0,
      format: 'percent',
      hint: `Estimate: ${number(totals?.uniqueOpens)} unique opens. Privacy proxies such as Apple Mail preload images, which inflates opens.`
    },
    {
      key: 'click',
      label: 'Click rate',
      value: rates?.click ?? 0,
      format: 'percent',
      hint: `${number(totals?.uniqueClicks)} unique clicks`
    },
    {
      key: 'ctor',
      label: 'Click-to-open',
      value: rates?.clickToOpen ?? 0,
      format: 'percent',
      hint: 'Unique clicks divided by unique opens'
    },
    {
      key: 'bounce',
      label: 'Bounces',
      value: rates?.bounce ?? 0,
      format: 'percent',
      hint: `${number(totals?.bounced)} bounced. Keep this under 2%.`
    },
    {
      key: 'complaint',
      label: 'Complaints',
      value: rates?.complaint ?? 0,
      format: 'percent',
      hint: `${number(totals?.complained)} spam reports. Keep this under 0.1%.`
    },
    {
      key: 'unsubscribe',
      label: 'Unsubscribes',
      value: rates?.unsubscribe ?? 0,
      format: 'percent',
      hint: `${number(totals?.unsubscribed)} unsubscribed`
    }
  ]
})

// Tabs --------------------------------------------------------------------------
const tab = ref<ReportTab>('overview')

const tabs = computed(() => {
  const items: TabsItem[] = [
    { label: 'Overview', value: 'overview', icon: 'i-lucide-chart-no-axes-column' }
  ]

  if (canReadRecipients.value) {
    items.push({
      label: 'Recipients',
      value: 'recipients',
      icon: 'i-lucide-users',
      badge: {
        label: number(report.value?.totals.recipients ?? props.broadcast.progress.recipients),
        color: 'neutral',
        variant: 'subtle',
        class: 'tabular-nums'
      }
    })
  }

  items.push({ label: 'Content', value: 'content', icon: 'i-lucide-mail' })

  return items
})

const previewUrl: string = `/api/broadcasts/${id}/preview`

const {
  data: preview,
  status: previewStatus,
  error: previewError,
  execute: loadPreview
} = useFetch<BroadcastPreview>(previewUrl, {
  lazy: true,
  server: false,
  immediate: false
})

watch(tab, (value) => {
  if (value === 'content' && !preview.value && previewStatus.value !== 'pending') void loadPreview()
})

// Actions -----------------------------------------------------------------------
const base: string = `/api/broadcasts/${id}`

const { run: pauseRun, pending: pausing } = useApiAction(
  () => $fetch<BroadcastDto>(`${base}/pause`, { method: 'POST' }),
  { success: 'Sending paused' }
)

const { run: resumeRun, pending: resuming } = useApiAction(
  () => $fetch<BroadcastDto>(`${base}/resume`, { method: 'POST' }),
  { success: 'Sending resumed' }
)

const { run: cancelRun, pending: cancelling } = useApiAction(
  () => $fetch<BroadcastDto>(`${base}/cancel`, { method: 'POST' }),
  { success: 'Broadcast cancelled' }
)

const { run: duplicateRun, pending: duplicating } = useApiAction(
  () => $fetch<BroadcastDto>(`${base}/duplicate`, { method: 'POST' }),
  { success: 'Broadcast duplicated' }
)

const { run: deleteRun } = useApiAction(() => $fetch<{ ok: boolean }>(base, { method: 'DELETE' }), {
  success: 'Broadcast deleted'
})

async function onPause() {
  if (await pauseRun()) emit('changed')
}

async function onResume() {
  if (await resumeRun()) emit('changed')
}

async function onCancel() {
  const pending = props.broadcast.progress.pending

  const ok = await confirm({
    title: `Cancel "${props.broadcast.name}"?`,
    description: pending
      ? `The ${number(pending)} recipients who haven't received it yet won't get it. Emails already sent can't be recalled.`
      : "Recipients who haven't received it yet won't get it. Emails already sent can't be recalled.",
    confirmLabel: 'Cancel broadcast',
    danger: true
  })

  if (ok && (await cancelRun())) emit('changed')
}

async function onDuplicate() {
  const copy = await duplicateRun()

  if (copy) await navigateTo(`/broadcasts/${copy.id}`)
}

async function onDelete() {
  const recipients = props.broadcast.progress.recipients

  const ok = await confirm({
    title: `Delete "${props.broadcast.name}"?`,
    description: recipients
      ? `Its report and the email log of its ${number(recipients)} recipients are deleted too. This can't be undone.`
      : "This can't be undone.",
    confirmLabel: 'Delete broadcast',
    danger: true
  })

  if (ok && (await deleteRun()) !== undefined) await navigateTo('/broadcasts')
}

/**
 * Header menu, limited to what the member's role allows (hidden when empty). Destructive items
 * come last, in their own group.
 */
const menuItems = computed(() => {
  const groups: DropdownMenuItem[][] = []

  if (canCreate.value)
    groups.push([{ label: 'Duplicate', icon: 'i-lucide-copy', onSelect: onDuplicate }])

  if (live.value && canSend.value) {
    groups.push([
      { label: 'Cancel broadcast', icon: 'i-lucide-ban', color: 'error', onSelect: onCancel }
    ])
  } else if (isBroadcastDeletable(props.broadcast) && canDelete.value) {
    groups.push([
      { label: 'Delete broadcast', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }
    ])
  }

  return groups
})

const failedActions = computed(() => {
  const actions: ButtonProps[] = []

  if (canReadAudit.value) {
    actions.push({
      label: 'View in audit log',
      variant: 'outline',
      size: 'xs',
      to: `/audit?entityType=broadcast&entityId=${props.broadcast.id}`
    })
  }

  return actions
})

const stoppedSummary = computed(() => {
  const { sent, recipients } = props.broadcast.progress

  const when = props.broadcast.completedAt
    ? ` ${relative(props.broadcast.completedAt, now.value)}`
    : ''

  return { when, reach: `${number(sent)} of ${number(recipients)} recipients received it.` }
})
</script>

<template>
  <UDashboardPanel id="broadcast-report">
    <template #header>
      <UDashboardNavbar :ui="{ left: 'min-w-0', title: 'min-w-0' }">
        <template #leading>
          <UTooltip text="Back to broadcasts">
            <UButton
              icon="i-lucide-arrow-left"
              variant="ghost"
              to="/broadcasts"
              aria-label="Back to broadcasts"
            />
          </UTooltip>
        </template>
        <template #title>
          <span class="truncate" :title="broadcast.name">{{ broadcast.name }}</span>
        </template>
        <template #trailing>
          <StatusBadge :status="broadcast.status" class="shrink-0" />
        </template>
        <template #right>
          <template v-if="canSend && status === 'sending'">
            <UButton
              label="Pause"
              icon="i-lucide-pause"
              variant="outline"
              :loading="pausing"
              @click="onPause"
            />
            <UButton
              label="Cancel"
              icon="i-lucide-ban"
              variant="ghost"
              :loading="cancelling"
              class="hidden sm:inline-flex"
              @click="onCancel"
            />
          </template>
          <template v-else-if="canSend && status === 'paused'">
            <UButton label="Resume" icon="i-lucide-play" :loading="resuming" @click="onResume" />
            <UButton
              label="Cancel"
              icon="i-lucide-ban"
              variant="ghost"
              :loading="cancelling"
              class="hidden sm:inline-flex"
              @click="onCancel"
            />
          </template>
          <UButton
            v-else-if="canSend && status === 'scheduled'"
            label="Cancel"
            icon="i-lucide-ban"
            variant="outline"
            :loading="cancelling"
            @click="onCancel"
          />
          <UButton
            v-if="!live && canCreate"
            label="Duplicate"
            icon="i-lucide-copy"
            variant="outline"
            :loading="duplicating"
            class="hidden sm:inline-flex"
            @click="onDuplicate"
          />
          <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More actions" />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <UTabs
          v-model="tab"
          :items="tabs"
          :content="false"
          size="sm"
          aria-label="Report sections"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
        <div class="min-w-0 space-y-6">
          <BroadcastsReportProgress
            v-if="live"
            :status="broadcast.status"
            :progress="broadcast.progress"
          />
          <UAlert
            v-else-if="status === 'cancelled'"
            icon="i-lucide-ban"
            title="Cancelled"
            :description="`Sending was cancelled${stoppedSummary.when}. ${stoppedSummary.reach}`"
          />
          <UAlert
            v-else-if="status === 'failed'"
            color="error"
            icon="i-lucide-circle-x"
            title="Sending failed"
            :description="`Sending stopped because of an error${stoppedSummary.when}. ${stoppedSummary.reach} The rest were not sent.`"
            :actions="failedActions"
          />

          <template v-if="tab === 'overview'">
            <EmptyState
              v-if="reportError && !report"
              variant="error"
              appearance="outline"
              title="Couldn't load the report"
              :description="apiErrorMessage(reportError)"
            >
              <UButton
                label="Retry"
                icon="i-lucide-rotate-cw"
                variant="outline"
                @click="() => refreshReport()"
              />
            </EmptyState>
            <template v-else>
              <div
                class="grid grid-cols-2 md:grid-cols-4 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden"
                aria-label="Key metrics"
                role="group"
                :aria-busy="reportLoading"
              >
                <KpiCard
                  v-for="kpi in kpis"
                  :key="kpi.key"
                  class="bg-default"
                  :label="kpi.label"
                  :value="kpi.value"
                  :format="kpi.format"
                  :hint="kpi.hint"
                  :loading="reportLoading"
                />
              </div>

              <BroadcastsReportTimeline
                :timeline="report?.timeline ?? []"
                :loading="reportRefreshing"
              />
              <BroadcastsReportBreakdowns :report="report ?? null" :loading="reportLoading" />
            </template>
          </template>

          <BroadcastsRecipientsTable
            v-else-if="tab === 'recipients' && canReadRecipients"
            :broadcast-id="broadcast.id"
            :live="status === 'sending'"
          />

          <BroadcastsPreviewFrame
            v-else
            :preview="preview ?? null"
            :pending="previewStatus === 'pending'"
            :error="!!previewError"
            :from-name="broadcast.fromName"
            :from-email="broadcast.fromEmail"
            :preheader="broadcast.preheader"
            note="Rendered with the current template and sample data. Each recipient received a personalized copy, which you can open from the recipients tab."
            @refresh="() => loadPreview()"
          />
        </div>

        <aside
          class="lg:sticky lg:top-0 rounded-lg ring ring-default p-4"
          aria-label="Broadcast details"
        >
          <BroadcastsReportDetails :broadcast="broadcast" />
        </aside>
      </div>
    </template>
  </UDashboardPanel>
</template>
