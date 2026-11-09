<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import { z } from 'zod'
import type { JsonValue } from '#shared/types/domain'
import type { InboundEventDetail, InboundEventItem } from '#shared/types/logs'
import type { DetailRow } from './DetailList.vue'
import type { LogTab } from './Panel.vue'
import { selectedEntrySchema, snsNotificationSchema } from '#shared/schemas/logs'

const tab = defineModel<LogTab>('tab', { required: true })

const STATUS_ITEMS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Processed', value: 'processed' },
  { label: 'Ignored', value: 'ignored' },
  { label: 'Failed', value: 'failed' }
]

const PERIOD_ITEMS = [
  { label: 'Any time', value: 'all' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' }
]

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

/** Filter values as the selects hold them (`all` means no filter). */
type InboundEventFilters = { status?: string; period?: string }

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
  filters: { status: undefined, period: undefined }
})

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
    meta: { class: { th: 'w-48', td: 'w-48' } },
    cell: ({ row }) =>
      h('span', { class: 'flex items-center gap-2 min-w-0 text-highlighted font-medium' }, [
        h(UIcon, {
          name: EVENT_ICONS.get(label(row.original)) ?? 'i-lucide-radio-tower',
          class: 'size-4 shrink-0 text-muted'
        }),
        h('span', { class: 'truncate' }, label(row.original))
      ])
  },
  {
    accessorKey: 'snsMessageId',
    header: 'SNS message',
    cell: ({ row }) =>
      h('span', { class: 'block truncate font-mono text-xs text-muted' }, row.original.snsMessageId)
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'error',
    header: 'Error',
    meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' } },
    cell: ({ row }) =>
      row.original.error
        ? h(
            'span',
            { class: 'block truncate text-error', title: row.original.error },
            row.original.error
          )
        : emptyCell()
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

const meta = computed<DetailRow[]>(() => {
  const d = detail.value

  if (!d) return []

  return [
    { label: 'SNS message ID', value: d.snsMessageId, copy: true },
    { label: 'Notification', value: d.type },
    { label: 'Event type', value: d.eventType },
    { label: 'Topic', value: d.topicArn, copy: true },
    { label: 'Received', value: dateTime(d.createdAt) }
  ]
})

/** SNS wraps the SES event as a JSON string in `Message`; show it parsed. */
const sesEvent = computed<JsonValue | null>(() => {
  const notification = snsNotificationSchema.safeParse(detail.value?.payload)

  if (!notification.success) return null

  try {
    return z.json().parse(JSON.parse(notification.data.Message))
  } catch {
    return null
  }
})

const search = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts({ '/': () => search.value?.inputRef?.focus() })
</script>

<template>
  <LogsPanel v-model:tab="tab">
    <template #filters>
      <UInput
        ref="search"
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search event type or message ID…"
        size="sm"
        class="w-full sm:w-64"
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
      <USelect
        v-model="filters.status"
        :items="STATUS_ITEMS"
        placeholder="All statuses"
        size="sm"
        class="w-36"
        aria-label="Filter by status"
      />
      <USelect
        v-model="filters.period"
        :items="PERIOD_ITEMS"
        placeholder="Any time"
        icon="i-lucide-calendar"
        size="sm"
        class="w-40"
        aria-label="Filter by time range"
      />
    </template>

    <template #actions>
      <UButton
        v-if="isFiltered"
        label="Clear filters"
        variant="ghost"
        size="sm"
        @click="clearFilters"
      />
      <UTooltip text="Refresh">
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          aria-label="Refresh events"
          :loading="loading"
          @click="() => refresh()"
        />
      </UTooltip>
    </template>

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
      :ui="tableUi"
      class="shrink-0"
      @select="onSelect"
    />
    <EmptyState
      v-else-if="isFiltered"
      variant="no-results"
      title="No events match your filters"
      description="Try another status or a wider time range."
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
      :title="detail ? (detail.eventType ?? detail.type) : 'Provider event'"
    >
      <template v-if="detail" #meta>
        <StatusBadge :status="detail.status" />
        <span class="tabular-nums">{{ dateTime(detail.createdAt) }}</span>
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
        <LogsDetailList :rows="meta" />
        <section v-if="sesEvent" class="space-y-2" aria-labelledby="inbound-ses-event">
          <h3 id="inbound-ses-event" class="text-sm font-semibold text-highlighted">SES event</h3>
          <JsonBlock :value="sesEvent" label="SES event" />
        </section>
        <section class="space-y-2" aria-labelledby="inbound-raw-notification">
          <h3 id="inbound-raw-notification" class="text-sm font-semibold text-highlighted">
            Raw notification
          </h3>
          <JsonBlock :value="detail.payload" label="Raw notification" max-height="16rem" />
        </section>
      </div>
    </LogsDetailSlideover>
  </LogsPanel>
</template>
