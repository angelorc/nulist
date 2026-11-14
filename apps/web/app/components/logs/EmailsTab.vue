<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { MessageKind } from '#shared/types/domain'
import type {
  EmailEngagement,
  EmailLogDetail,
  EmailLogFacets,
  EmailLogItem,
  EmailLogStats
} from '#shared/types/logs'
import type { FacetOption } from '../facets/Group.vue'
import type { OverviewTile } from './Overview.vue'
import type { LogTab } from './Panel.vue'
import { selectedEntrySchema } from '#shared/schemas/logs'

const tab = defineModel<LogTab>('tab', { required: true })

const KIND_LABELS = new Map<string, string>([
  ['broadcast', 'Broadcast'],
  ['transactional', 'Transactional'],
  ['system', 'System']
] satisfies [MessageKind, string][])

const ENGAGEMENTS = new Map<string, Pick<FacetOption, 'label' | 'icon' | 'description'>>([
  [
    'clicked',
    { label: 'Clicked', icon: 'i-lucide-mouse-pointer-click', description: 'Clicked a link' }
  ],
  [
    'opened',
    { label: 'Opened, no click', icon: 'i-lucide-eye', description: 'Opened without a click' }
  ],
  ['none', { label: 'Not opened', icon: 'i-lucide-eye-off', description: 'No open or click' }]
] satisfies [EmailEngagement, Pick<FacetOption, 'label' | 'icon' | 'description'>][])

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** Filter values as the URL query holds them (lists comma-joined). */
type EmailLogFilters = {
  outcome?: string
  status?: string
  kind?: string
  engagement?: string
  broadcastId?: string
  contactId?: string
  templateId?: string
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
} = usePaginatedList<EmailLogItem, EmailLogFilters>('/api/logs/emails', {
  filters: {
    outcome: undefined,
    status: undefined,
    kind: undefined,
    engagement: undefined,
    broadcastId: undefined,
    contactId: undefined,
    templateId: undefined,
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
} = useLogStats<EmailLogStats>('/api/logs/emails/stats', q, filters, ['outcome', 'status'])

const {
  facets,
  loading: facetsLoading,
  refresh: refreshFacets,
  range,
  active,
  clear
} = useLogFacets<EmailLogFacets>('/api/logs/emails/facets', q, filters)

const statusOptions = computed(() =>
  facetOptions(facets.value?.facets.status, filters.status, (value) => ({
    label: sentenceCase(value),
    color: statusColor(value)
  }))
)

const kindOptions = computed(() =>
  facetOptions(facets.value?.facets.kind, filters.kind, (value) => ({
    label: KIND_LABELS.get(value) ?? sentenceCase(value)
  }))
)

const engagementOptions = computed(() =>
  facetOptions(
    facets.value?.facets.engagement,
    filters.engagement,
    (value) => ENGAGEMENTS.get(value) ?? { label: value }
  )
)

const broadcastOptions = computed(() =>
  facetOptions(facets.value?.facets.broadcastId, filters.broadcastId, (_value, label) => ({
    label: label ?? (facets.value ? 'Unknown broadcast' : 'Loading…')
  }))
)

/** A single broadcast the page was opened for (a deep link), pinned as a scope chip. */
const linkedBroadcast = filters.broadcastId?.includes(',') ? undefined : filters.broadcastId

interface ScopeChip {
  key: 'contactId' | 'templateId' | 'broadcastId' | 'recipient'
  label: string
}

const scopes = computed<ScopeChip[]>(() => {
  const scope = facets.value?.scope
  const pending = !facets.value
  const chips: ScopeChip[] = []

  if (filters.contactId) {
    const email = scope?.contact?.email ?? (pending ? '…' : 'Unknown contact')

    chips.push({ key: 'contactId', label: `Contact: ${email}` })
  }

  if (filters.recipient) {
    chips.push({ key: 'recipient', label: `Recipient: ${filters.recipient}` })
  }

  if (filters.templateId) {
    const name = scope?.template?.name ?? (pending ? '…' : 'Unknown template')

    chips.push({ key: 'templateId', label: `Template: ${name}` })
  }

  if (linkedBroadcast && filters.broadcastId === linkedBroadcast) {
    const name = broadcastOptions.value.find((option) => option.value === linkedBroadcast)?.label

    chips.push({ key: 'broadcastId', label: `Broadcast: ${name ?? '…'}` })
  }

  return chips
})

const STATUS_FILTERED = 'status'

const outcome = computed<string | undefined>({
  get: () => (filters.status ? STATUS_FILTERED : filters.outcome),
  set: (value) => {
    filters.outcome = value
    filters.status = undefined
  }
})

const tiles = computed<OverviewTile[]>(() => {
  const counts = stats.value?.facets

  return [
    { key: 'all', label: 'All emails', value: stats.value?.total ?? null, selectable: true },
    {
      key: 'delivered',
      label: 'Delivered',
      value: counts?.delivered ?? null,
      tone: 'success',
      selectable: true
    },
    {
      key: 'in_flight',
      label: 'In progress',
      value: counts?.in_flight ?? null,
      tone: 'warning',
      selectable: true
    },
    {
      key: 'issues',
      label: 'Bounced or failed',
      value: counts?.issues ?? null,
      tone: 'error',
      selectable: true
    },
    {
      key: 'skipped',
      label: 'Suppressed',
      value: counts?.skipped ?? null,
      tone: 'neutral',
      selectable: true
    }
  ]
})

watch(
  () => filters.status,
  (value) => {
    if (value) filters.outcome = undefined
  }
)

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
  () => `log-email-${selectedId.value ?? 'none'}`,
  () => {
    const id = selectedId.value

    if (!id) return Promise.resolve(null)
    const url: string = `/api/logs/emails/${id}`

    return $fetch<EmailLogDetail>(url)
  },
  { server: false }
)

const UBadge = resolveComponent('UBadge')
const UIcon = resolveComponent('UIcon')

function engagement(item: EmailLogItem) {
  if (!item.openCount && !item.clickCount) return emptyCell()

  return h('span', { class: 'flex items-center justify-end gap-3 text-muted tabular-nums' }, [
    h('span', { class: 'inline-flex items-center gap-1', title: `${item.openCount} opens` }, [
      h(UIcon, { name: 'i-lucide-eye', class: 'size-3.5', 'aria-hidden': 'true' }),
      h('span', { class: 'sr-only' }, 'Opens'),
      String(item.openCount)
    ]),
    h('span', { class: 'inline-flex items-center gap-1', title: `${item.clickCount} clicks` }, [
      h(UIcon, { name: 'i-lucide-mouse-pointer-click', class: 'size-3.5', 'aria-hidden': 'true' }),
      h('span', { class: 'sr-only' }, 'Clicks'),
      String(item.clickCount)
    ])
  ])
}

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
    cell: ({ row }) => h(UBadge, { variant: 'outline', label: KIND_LABELS.get(row.original.kind) })
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    id: 'engagement',
    header: 'Engagement',
    meta: {
      class: {
        th: 'w-32 hidden lg:table-cell text-right',
        td: 'w-32 hidden lg:table-cell text-right'
      }
    },
    cell: ({ row }) => engagement(row.original)
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
</script>

<template>
  <LogsPanel
    v-model:tab="tab"
    v-model:range="range"
    :active="active"
    :loading="loading"
    refresh-label="Refresh emails"
    @clear="clear"
    @refresh="refreshAll"
  >
    <template #facets>
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search recipient or subject…"
        size="sm"
        class="w-full"
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
      <div v-if="scopes.length" class="flex flex-wrap gap-1.5">
        <UButton
          v-for="chip in scopes"
          :key="chip.key"
          :label="chip.label"
          trailing-icon="i-lucide-x"
          color="neutral"
          variant="outline"
          size="xs"
          class="max-w-full"
          :ui="{ label: 'truncate' }"
          :aria-label="`Remove filter ${chip.label}`"
          @click="filters[chip.key] = undefined"
        />
      </div>
      <FacetsGroup
        v-model="filters.status"
        title="Status"
        :items="statusOptions"
        :loading="facetsLoading"
      />
      <FacetsGroup
        v-model="filters.engagement"
        title="Engagement"
        :items="engagementOptions"
        :loading="facetsLoading"
      />
      <FacetsGroup
        v-model="filters.kind"
        title="Kind"
        :items="kindOptions"
        :loading="facetsLoading"
      />
      <FacetsGroup
        v-model="filters.broadcastId"
        title="Broadcast"
        :items="broadcastOptions"
        :loading="facetsLoading"
      />
    </template>

    <LogsOverview
      v-model:selected="outcome"
      title="Email volume"
      :tiles="tiles"
      :stats="stats"
      :loading="statsLoading"
      :series="{ ok: 'Delivered', other: 'Other', issues: 'Bounced or failed' }"
    />

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
      :ui="wideTableUi"
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
