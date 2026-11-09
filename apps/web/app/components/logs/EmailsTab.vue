<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { MessageKind } from '#shared/types/domain'
import type { EmailLogDetail, EmailLogItem } from '#shared/types/logs'
import type { LogTab } from './Panel.vue'
import { selectedEntrySchema } from '#shared/schemas/logs'

const tab = defineModel<LogTab>('tab', { required: true })

const STATUS_ITEMS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Sent', value: 'sent' },
  { label: 'Queued', value: 'queued' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Bounced', value: 'bounced' },
  { label: 'Complained', value: 'complained' },
  { label: 'Failed', value: 'failed' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Suppressed', value: 'suppressed' },
  { label: 'Cancelled', value: 'cancelled' }
]

const KIND_LABELS: Record<MessageKind, string> = {
  broadcast: 'Broadcast',
  transactional: 'Transactional',
  system: 'System'
}

const KIND_ITEMS = [
  { label: 'All kinds', value: 'all' },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ label, value }))
]

const PERIOD_ITEMS = [
  { label: 'Any time', value: 'all' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' }
]

/** Filter values as the selects hold them (`all` means no filter). */
type EmailLogFilters = {
  status?: string
  kind?: string
  period?: string
  broadcastId?: string
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
} = usePaginatedList<EmailLogItem, EmailLogFilters>('/api/logs/emails', {
  filters: { status: undefined, kind: undefined, period: undefined, broadcastId: undefined }
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
  () => `log-email-${selectedId.value ?? 'none'}`,
  () => {
    const id = selectedId.value

    if (!id) return Promise.resolve(null)
    const url: string = `/api/logs/emails/${id}`

    return $fetch<EmailLogDetail>(url)
  },
  { server: false }
)

const broadcastFilterName = computed(() =>
  filters.broadcastId
    ? (items.value.find((i) => i.broadcast?.id === filters.broadcastId)?.broadcast?.name ??
      'Selected broadcast')
    : null
)

const UBadge = resolveComponent('UBadge')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<EmailLogItem>[] = [
  {
    accessorKey: 'toEmail',
    header: 'To',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'block truncate font-mono text-xs text-highlighted' },
        row.original.toEmail
      )
  },
  {
    accessorKey: 'subject',
    header: 'Subject',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'truncate text-default' }, row.original.subject || '(no subject)'),
        row.original.broadcast
          ? h('p', { class: 'truncate text-xs text-muted' }, row.original.broadcast.name)
          : null
      ])
  },
  {
    accessorKey: 'kind',
    header: 'Kind',
    meta: { class: { th: 'w-32 hidden md:table-cell', td: 'w-32 hidden md:table-cell' } },
    cell: ({ row }) => h(UBadge, { variant: 'outline', label: KIND_LABELS[row.original.kind] })
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    id: 'time',
    header: 'Time',
    meta: {
      class: { th: 'w-28 hidden sm:table-cell', td: 'w-28 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.sentAt ?? row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<EmailLogItem>) {
  selectedId.value = row.original.id
}

const rowIds = computed(() => items.value.map((i) => i.id))

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
        placeholder="Search recipient or subject…"
        size="sm"
        class="w-full sm:w-64"
        aria-label="Search emails"
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
        v-model="filters.kind"
        :items="KIND_ITEMS"
        placeholder="All kinds"
        size="sm"
        class="w-36"
        aria-label="Filter by kind"
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
      <UButton
        v-if="broadcastFilterName"
        :label="`Broadcast: ${broadcastFilterName}`"
        trailing-icon="i-lucide-x"
        variant="outline"
        size="sm"
        class="max-w-64"
        :aria-label="`Remove filter Broadcast: ${broadcastFilterName}`"
        @click="filters.broadcastId = undefined"
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
          aria-label="Refresh emails"
          :loading="loading"
          @click="() => refresh()"
        />
      </UTooltip>
    </template>

    <EmptyState
      v-if="error && !items.length"
      variant="error"
      title="Email logs could not be loaded"
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
      title="No emails match your filters"
      description="Try a different status or a wider time range."
    >
      <UButton label="Clear filters" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      icon="i-lucide-mail"
      title="No emails sent yet"
      description="Every broadcast, transactional and system email shows up here with its delivery events."
    >
      <Can :permission="{ broadcast: ['create'] }">
        <UButton label="New broadcast" icon="i-lucide-plus" to="/broadcasts?new=1" />
      </Can>
    </EmptyState>

    <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="email" />

    <LogsDetailSlideover
      v-model:id="selectedId"
      :ids="rowIds"
      :title="detail?.subject ?? 'Email'"
      wide
    >
      <template v-if="detail" #meta>
        <span class="font-mono text-xs text-muted truncate">{{ detail.toEmail }}</span>
        <StatusBadge :status="detail.status" />
      </template>

      <div
        v-if="detailStatus === 'pending' && !detail"
        class="space-y-6"
        aria-busy="true"
        aria-label="Loading email"
      >
        <div class="space-y-4">
          <div v-for="i in 4" :key="i" class="flex gap-3">
            <USkeleton class="size-6 shrink-0 rounded-full" />
            <div class="flex-1 space-y-1.5">
              <USkeleton class="h-3 w-32" />
              <USkeleton class="h-4 w-48" />
            </div>
          </div>
        </div>
        <USkeleton class="h-8 w-64" />
        <USkeleton class="h-72 w-full" />
      </div>
      <EmptyState
        v-else-if="detailError"
        variant="error"
        title="This email could not be loaded"
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
      <LogsEmailDetail v-else-if="detail" :message="detail" />
    </LogsDetailSlideover>
  </LogsPanel>
</template>
