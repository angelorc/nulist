<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import { z } from 'zod'
import type { JsonValue } from '#shared/types/domain'
import type {
  InboundEventDetail,
  InboundEventFacets,
  InboundEventItem,
  InboundEventStats
} from '#shared/types/logs'
import type { DetailRow } from './DetailList.vue'
import type { OverviewTile } from './Overview.vue'
import type { LogTab } from './Panel.vue'
import { SES_EVENT_TYPES, selectedEntrySchema, snsNotificationSchema } from '#shared/schemas/logs'

const tab = defineModel<LogTab>('tab', { required: true })

/** Icon per SES event type (`eventType` of the notification). */
const EVENT_ICONS = new Map([
  ['Delivery', 'i-lucide-mail-check'],
  ['Bounce', 'i-lucide-circle-x'],
  ['Complaint', 'i-lucide-shield-alert'],
  ['Open', 'i-lucide-eye'],
  ['Click', 'i-lucide-mouse-pointer-click'],
  ['Send', 'i-lucide-send'],
  ['Reject', 'i-lucide-ban'],
  ['DeliveryDelay', 'i-lucide-clock-alert'],
  ['Rendering Failure', 'i-lucide-file-x'],
  ['Subscription', 'i-lucide-user-minus']
])

const EVENT_TONE = new Map([
  ['Delivery', 'text-success'],
  ['Bounce', 'text-error'],
  ['Complaint', 'text-error'],
  ['Reject', 'text-error'],
  ['Rendering Failure', 'text-error'],
  ['DeliveryDelay', 'text-warning'],
  ['Open', 'text-primary'],
  ['Click', 'text-primary']
])

const EVENT_LABELS = new Map([
  ['DeliveryDelay', 'Delivery delay'],
  ['Rendering Failure', 'Rendering failure']
])

const eventLabel = (type: string) => EVENT_LABELS.get(type) ?? type

const SES_TYPES = new Set<string>(SES_EVENT_TYPES)

/** Filter values as the URL query holds them (lists comma-joined). */
type InboundEventFilters = {
  status?: string
  eventType?: string
  recipient?: string
  period?: string
  from?: string
  to?: string
}

const {
  page,
  pageSize,
  q,
  filters,
  items,
  total,
  loading,
  error,
  refresh,
  isFiltered,
  clearFilters
} = usePaginatedList<InboundEventItem, InboundEventFilters>('/api/logs/inbound', {
  filters: {
    status: undefined,
    eventType: undefined,
    recipient: undefined,
    period: undefined,
    from: undefined,
    to: undefined
  }
})

const {
  stats,
  loading: statsLoading,
  refresh: refreshStats
} = useLogStats<InboundEventStats>('/api/logs/inbound/stats', q, filters, ['status', 'eventType'])

const {
  facets,
  loading: facetsLoading,
  refresh: refreshFacets,
  range,
  active,
  clear
} = useLogFacets<InboundEventFacets>('/api/logs/inbound/facets', q, filters)

const statusOptions = computed(() =>
  facetOptions(facets.value?.facets.status, filters.status, (value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    color: statusColor(value)
  }))
)

const eventTypeOptions = computed(() =>
  facetOptions(
    facets.value?.facets.eventType.filter((bucket) => SES_TYPES.has(bucket.value)),
    filters.eventType,
    (value) => ({
      label: eventLabel(value),
      icon: EVENT_ICONS.get(value) ?? 'i-lucide-radio-tower'
    })
  )
)

const tiles = computed<OverviewTile[]>(() => {
  const s = stats.value

  return [
    { key: 'all', label: 'All events', value: s?.total ?? null, selectable: true },
    {
      key: 'processed',
      label: 'Processed',
      value: s?.facets.processed ?? null,
      tone: 'success',
      selectable: true
    },
    {
      key: 'ignored',
      label: 'Ignored',
      value: s?.facets.ignored ?? null,
      tone: 'neutral',
      selectable: true
    },
    {
      key: 'failed',
      label: 'Failed',
      value: s?.facets.failed ?? null,
      tone: 'error',
      selectable: true
    }
  ]
})

function refreshAll() {
  void refresh()
  void refreshStats()
  void refreshFacets()
}

const route = useRoute()
const router = useRouter()

const selectedId = computed<string | undefined>({
  get: () => selectedEntrySchema.parse(route.query.id),
  set: (id) => router.replace({ query: { ...route.query, id } })
})

const {
  data: detail,
  status: detailStatus,
  error: detailError,
  refresh: refreshDetail
} = useAsyncData(
  () => `log-inbound-${selectedId.value ?? 'none'}`,
  () => {
    const id = selectedId.value

    if (!id) return Promise.resolve(null)
    const url: string = `/api/logs/inbound/${id}`

    return $fetch<InboundEventDetail>(url)
  },
  { server: false }
)

const { dateTime } = useFormat()

const UIcon = resolveComponent('UIcon')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const label = (item: InboundEventItem) => item.eventType ?? item.type

const columns: TableColumn<InboundEventItem>[] = [
  {
    id: 'event',
    header: 'Event',
    meta: { class: { th: 'w-44', td: 'w-44' } },
    cell: ({ row }) =>
      h('span', { class: 'flex items-center gap-2 min-w-0 text-highlighted font-medium' }, [
        h(UIcon, {
          name: EVENT_ICONS.get(label(row.original)) ?? 'i-lucide-radio-tower',
          class: ['size-4 shrink-0', EVENT_TONE.get(label(row.original)) ?? 'text-muted']
        }),
        h('span', { class: 'truncate' }, eventLabel(label(row.original)))
      ])
  },
  {
    id: 'recipient',
    header: 'Recipient',
    meta: { class: { th: 'w-72', td: 'w-72' } },
    cell: ({ row }) =>
      row.original.recipient
        ? h('div', { class: 'min-w-0' }, [
            h(
              'p',
              { class: 'truncate font-mono text-xs text-highlighted' },
              row.original.recipient
            ),
            row.original.message
              ? h('p', { class: 'truncate text-xs text-muted' }, row.original.message.subject)
              : null
          ])
        : emptyCell()
  },
  {
    id: 'detail',
    header: 'Detail',
    meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } },
    cell: ({ row }) => {
      const text = row.original.error ?? row.original.detail

      if (!text) return emptyCell()

      return h(
        'span',
        {
          class: ['block truncate', row.original.error ? 'text-error' : 'text-muted'],
          title: text
        },
        text
      )
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-28', td: 'w-28' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'createdAt',
    header: 'Received',
    meta: { class: { th: 'w-28', td: 'w-28 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<InboundEventItem>) {
  selectedId.value = row.original.id
}

const rowIds = computed(() => items.value.map((i) => i.id))

const summary = computed<DetailRow[]>(() => {
  const d = detail.value

  if (!d) return []

  return [
    { label: 'Event', value: eventLabel(d.eventType ?? d.type) },
    { label: 'Recipient', value: d.recipient, mono: true },
    {
      label: 'Email',
      value: d.message?.subject,
      to: d.message ? `/logs?tab=emails&id=${d.message.id}` : undefined
    },
    { label: 'Detail', value: d.detail },
    { label: 'Received', value: dateTime(d.createdAt) }
  ]
})

const delivery = computed<DetailRow[]>(() => {
  const d = detail.value

  if (!d) return []

  return [
    { label: 'SNS message ID', value: d.snsMessageId, copy: true },
    { label: 'Notification', value: d.type },
    { label: 'Topic', value: d.topicArn, copy: true },
    { label: 'Event ID', value: d.id, copy: true }
  ]
})

/** SNS wraps the SES event as a JSON string in `Message`; show it parsed. */
const wrappedEvent = computed<JsonValue | null>(() => {
  const notification = snsNotificationSchema.safeParse(detail.value?.payload)

  if (!notification.success) return null

  try {
    return z.json().parse(JSON.parse(notification.data.Message))
  } catch {
    return null
  }
})

const sesEvent = computed<JsonValue | null>(
  () => wrappedEvent.value ?? detail.value?.payload ?? null
)

const detailTabs = computed(() => [
  { label: 'SES event', value: 'event', slot: 'event' as const },
  ...(wrappedEvent.value
    ? [{ label: 'Raw notification', value: 'raw', slot: 'raw' as const }]
    : []),
  { label: 'Delivery', value: 'delivery', slot: 'delivery' as const }
])
</script>

<template>
  <LogsPanel
    v-model:tab="tab"
    v-model:range="range"
    :active="active"
    :loading="loading"
    refresh-label="Refresh events"
    @clear="clear"
    @refresh="refreshAll"
  >
    <template #facets>
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search recipient, event or message ID…"
        size="sm"
        class="w-full"
        aria-label="Search events"
      >
        <template #trailing>
          <UKbd v-if="!q" value="/" />
          <UButton
            v-else
            icon="i-lucide-x"
            variant="link"
            size="xs"
            aria-label="Clear search"
            @click="q = ''"
          />
        </template>
      </UInput>
      <div v-if="filters.recipient">
        <UButton
          :label="`Recipient: ${filters.recipient}`"
          trailing-icon="i-lucide-x"
          color="neutral"
          variant="outline"
          size="xs"
          class="max-w-full"
          :ui="{ label: 'truncate' }"
          :aria-label="`Remove filter Recipient: ${filters.recipient}`"
          @click="filters.recipient = undefined"
        />
      </div>
      <FacetsGroup
        v-model="filters.eventType"
        title="Event type"
        :items="eventTypeOptions"
        :loading="facetsLoading"
        :limit="10"
      />
      <FacetsGroup
        v-model="filters.status"
        title="Status"
        :items="statusOptions"
        :loading="facetsLoading"
      />
    </template>

    <LogsOverview
      v-model:selected="filters.status"
      title="Event volume"
      :tiles="tiles"
      :stats="stats"
      :loading="statsLoading"
      :series="{ ok: 'Processed', other: 'Ignored', issues: 'Failed' }"
    />

    <EmptyState
      v-if="error && !items.length"
      variant="error"
      title="Provider events could not be loaded"
      :description="apiErrorMessage(error)"
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        @click="() => refresh()"
      />
    </EmptyState>
    <UTable
      v-else-if="loading || items.length"
      :data="items"
      :columns="columns"
      :loading="loading"
      sticky
      :ui="wideTableUi"
      class="shrink-0"
      @select="onSelect"
    />
    <EmptyState
      v-else-if="isFiltered"
      variant="no-results"
      title="No events match your filters"
      description="Try another event type, status or a wider time range."
    >
      <UButton label="Clear filters" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      icon="i-lucide-radio-tower"
      title="No provider events received yet"
      description="Point an SES configuration set at an SNS topic that posts to /api/webhooks/ses to receive deliveries, bounces, complaints, opens and clicks."
    >
      <Can :permission="{ settings: ['read'] }">
        <UButton
          label="Sending settings"
          icon="i-lucide-settings"
          variant="outline"
          to="/settings/sending"
        />
      </Can>
    </EmptyState>

    <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="event" />

    <LogsDetailSlideover
      v-model:id="selectedId"
      :ids="rowIds"
      :title="detail ? eventLabel(detail.eventType ?? detail.type) : 'Provider event'"
    >
      <template v-if="detail" #meta>
        <StatusBadge :status="detail.status" />
        <span v-if="detail.recipient" class="font-mono text-xs text-muted truncate">{{
          detail.recipient
        }}</span>
      </template>

      <div
        v-if="detailStatus === 'pending' && !detail"
        class="space-y-6"
        aria-busy="true"
        aria-label="Loading event"
      >
        <USkeleton class="h-48 w-full" />
        <div class="space-y-2">
          <USkeleton class="h-4 w-24" />
          <USkeleton class="h-64 w-full" />
        </div>
      </div>
      <EmptyState
        v-else-if="detailError"
        variant="error"
        title="This event could not be loaded"
        :description="apiErrorMessage(detailError)"
        compact
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          @click="() => refreshDetail()"
        />
      </EmptyState>
      <div v-else-if="detail" class="space-y-6">
        <UAlert
          v-if="detail.error"
          color="error"
          icon="i-lucide-circle-alert"
          title="Processing error"
          :description="detail.error"
        />
        <section class="space-y-2" aria-labelledby="inbound-summary">
          <div class="flex items-center justify-between gap-2">
            <h3 id="inbound-summary" class="text-sm font-semibold text-highlighted">Summary</h3>
            <UButton
              v-if="detail.message"
              label="Open email"
              icon="i-lucide-mail"
              variant="link"
              size="xs"
              :to="`/logs?tab=emails&id=${detail.message.id}`"
            />
          </div>
          <LogsDetailList :rows="summary.filter((row) => row.value)" />
        </section>
        <UTabs
          :items="detailTabs"
          default-value="event"
          variant="link"
          size="sm"
          :ui="{ content: 'pt-3' }"
        >
          <template #event>
            <JsonBlock v-if="sesEvent" :value="sesEvent" label="SES event" />
            <p v-else class="text-[13px] text-muted">
              The notification does not carry an SES event.
            </p>
          </template>
          <template #raw>
            <JsonBlock :value="detail.payload" label="Raw notification" />
          </template>
          <template #delivery>
            <LogsDetailList :rows="delivery" />
          </template>
        </UTabs>
      </div>
    </LogsDetailSlideover>
  </LogsPanel>
</template>
