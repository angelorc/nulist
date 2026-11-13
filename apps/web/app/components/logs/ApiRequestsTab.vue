<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { JsonValue } from '#shared/types/domain'
import type {
  ApiLogDetail,
  ApiLogFacets,
  ApiLogItem,
  ApiLogStats,
  StatusClass
} from '#shared/types/logs'
import type { FacetOption } from '../facets/Group.vue'
import type { DetailRow } from './DetailList.vue'
import type { OverviewTile } from './Overview.vue'
import type { LogTab } from './Panel.vue'
import { selectedEntrySchema } from '#shared/schemas/logs'

const tab = defineModel<LogTab>('tab', { required: true })

const STATUS_CLASSES = new Map<string, Pick<FacetOption, 'label' | 'color'>>([
  ['2xx', { label: '2xx success', color: 'success' }],
  ['3xx', { label: '3xx redirect', color: 'info' }],
  ['4xx', { label: '4xx client error', color: 'warning' }],
  ['5xx', { label: '5xx server error', color: 'error' }]
] satisfies [StatusClass, Pick<FacetOption, 'label' | 'color'>][])

/** Filter values as the URL query holds them (lists comma-joined). */
type ApiLogFilters = {
  status?: string
  method?: string
  apiKeyId?: string
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
} = usePaginatedList<ApiLogItem, ApiLogFilters>('/api/logs/api', {
  filters: {
    status: undefined,
    method: undefined,
    apiKeyId: undefined,
    period: undefined,
    from: undefined,
    to: undefined
  }
})

const {
  facets,
  loading: facetsLoading,
  refresh: refreshFacets,
  range,
  active,
  clear
} = useLogFacets<ApiLogFacets>('/api/logs/api/facets', q, filters)

const statusOptions = computed(() =>
  facetOptions(
    facets.value?.facets.status,
    filters.status,
    (value) => STATUS_CLASSES.get(value) ?? { label: value }
  )
)

const methodOptions = computed(() =>
  facetOptions(facets.value?.facets.method, filters.method, (value) => ({ label: value }))
)

const apiKeyOptions = computed(() =>
  facetOptions(facets.value?.facets.apiKeyId, filters.apiKeyId, (_value, label) => ({
    label: label ?? (facets.value ? 'Unnamed key' : 'Loading…')
  }))
)

const { number, dateTime } = useFormat()

const {
  stats,
  loading: statsLoading,
  refresh: refreshStats
} = useLogStats<ApiLogStats>('/api/logs/api/stats', q, filters, ['status'])

const tiles = computed<OverviewTile[]>(() => {
  const s = stats.value

  return [
    { key: 'all', label: 'All requests', value: s?.total ?? null, selectable: true },
    {
      key: '2xx',
      label: 'Successful',
      value: s?.facets['2xx'] ?? null,
      tone: 'success',
      selectable: true
    },
    {
      key: '4xx',
      label: 'Client errors',
      value: s?.facets['4xx'] ?? null,
      tone: 'warning',
      selectable: true
    },
    {
      key: '5xx',
      label: 'Server errors',
      value: s?.facets['5xx'] ?? null,
      tone: 'error',
      selectable: true
    },
    {
      key: 'p95',
      label: 'p95 latency',
      value: s?.p95Ms ?? null,
      display: s?.p95Ms == null ? '—' : `${number(s.p95Ms)} ms`,
      hint: '95% of requests completed within this time.'
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
  () => `log-api-${selectedId.value ?? 'none'}`,
  () => {
    const id = selectedId.value

    if (!id) return Promise.resolve(null)
    const url: string = `/api/logs/api/${id}`

    return $fetch<ApiLogDetail>(url)
  },
  { server: false }
)

const MethodBadge = resolveComponent('LogsMethodBadge')
const StatusCode = resolveComponent('LogsStatusCode')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<ApiLogItem>[] = [
  {
    accessorKey: 'method',
    header: 'Method',
    meta: { class: { th: 'w-24', td: 'w-24' } },
    cell: ({ row }) => h(MethodBadge, { method: row.original.method })
  },
  {
    accessorKey: 'path',
    header: 'Path',
    cell: ({ row }) =>
      h('span', { class: 'block truncate font-mono text-xs text-highlighted' }, row.original.path)
  },
  {
    accessorKey: 'statusCode',
    header: 'Status',
    meta: { class: { th: 'w-20', td: 'w-20' } },
    cell: ({ row }) => h(StatusCode, { code: row.original.statusCode })
  },
  {
    accessorKey: 'durationMs',
    header: 'Duration',
    meta: {
      class: {
        th: 'w-24 hidden sm:table-cell text-right',
        td: 'w-24 hidden sm:table-cell text-right tabular-nums text-muted'
      }
    },
    cell: ({ row }) => `${number(row.original.durationMs)} ms`
  },
  {
    id: 'apiKey',
    header: 'API key',
    meta: {
      class: { th: 'w-44 hidden lg:table-cell', td: 'w-44 hidden lg:table-cell text-muted' }
    },
    cell: ({ row }) => {
      const key = row.original.apiKey

      if (!key) return emptyCell()

      return h('div', { class: 'min-w-0' }, [
        h('p', { class: 'truncate text-default' }, key.name ?? 'Unnamed key'),
        key.start
          ? h('p', { class: 'truncate font-mono text-xs text-muted' }, `${key.start}…`)
          : null
      ])
    }
  },
  {
    accessorKey: 'createdAt',
    header: 'Time',
    meta: { class: { th: 'w-28', td: 'w-28 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<ApiLogItem>) {
  selectedId.value = String(row.original.id)
}

const rowIds = computed(() => items.value.map((i) => String(i.id)))

const { can } = useOrganization()

const meta = computed<DetailRow[]>(() => {
  const d = detail.value

  if (!d) return []

  return [
    { label: 'Request ID', value: String(d.id), copy: true },
    { label: 'Time', value: dateTime(d.createdAt) },
    { label: 'Duration', value: `${number(d.durationMs)} ms` },
    {
      label: 'API key',
      value: d.apiKey
        ? `${d.apiKey.name ?? 'Unnamed key'}${d.apiKey.start ? ` (${d.apiKey.start}…)` : ''}`
        : null,
      to: d.apiKey && can({ apiKey: ['read'] }) ? '/settings/api-keys' : undefined
    },
    { label: 'IP address', value: d.ip, mono: true },
    { label: 'User agent', value: d.userAgent, mono: true }
  ]
})

/** Whether a recorded body has content: `null`, `{}` and `[]` count as none. */
function hasBody(value: JsonValue | null): boolean {
  if (value === null) return false

  return value instanceof Object ? Object.keys(value).length > 0 : true
}
</script>

<template>
  <LogsPanel
    v-model:tab="tab"
    v-model:range="range"
    :active="active"
    :loading="loading"
    refresh-label="Refresh API requests"
    @clear="clear"
    @refresh="refreshAll"
  >
    <template #facets>
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search path…"
        size="sm"
        class="w-full"
        aria-label="Search requests by path"
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
      <FacetsGroup
        v-model="filters.status"
        title="Response"
        :items="statusOptions"
        :loading="facetsLoading"
      />
      <FacetsGroup
        v-model="filters.method"
        title="Method"
        :items="methodOptions"
        :loading="facetsLoading"
      />
      <FacetsGroup
        v-model="filters.apiKeyId"
        title="API key"
        :items="apiKeyOptions"
        :loading="facetsLoading"
      />
    </template>

    <LogsOverview
      v-model:selected="filters.status"
      title="Request volume"
      :tiles="tiles"
      :stats="stats"
      :loading="statsLoading"
      :series="{ ok: 'Successful', issues: 'Errors' }"
    />

    <EmptyState
      v-if="error && !items.length"
      variant="error"
      title="API logs could not be loaded"
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
      title="No requests match your filters"
      description="Try another method, response status or a wider time range."
    >
      <UButton label="Clear filters" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      icon="i-lucide-terminal"
      title="No API requests yet"
      description="Requests made with an API key to the REST API are logged here with their payloads."
    >
      <Can :permission="{ apiKey: ['create'] }">
        <UButton label="Create an API key" icon="i-lucide-key-round" to="/settings/api-keys" />
      </Can>
    </EmptyState>

    <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="request" />

    <LogsDetailSlideover
      v-model:id="selectedId"
      :ids="rowIds"
      :title="detail ? `${detail.method} ${detail.path}` : 'API request'"
    >
      <template v-if="detail" #title>
        <span class="inline-flex items-center gap-2 min-w-0 max-w-full">
          <LogsMethodBadge :method="detail.method" />
          <span class="font-mono text-sm truncate">{{ detail.path }}</span>
        </span>
      </template>
      <template v-if="detail" #meta>
        <LogsStatusCode :code="detail.statusCode" />
        <span class="tabular-nums">{{ number(detail.durationMs) }} ms</span>
      </template>

      <div
        v-if="detailStatus === 'pending' && !detail"
        class="space-y-6"
        aria-busy="true"
        aria-label="Loading request"
      >
        <USkeleton class="h-56 w-full" />
        <div class="space-y-2">
          <USkeleton class="h-4 w-28" />
          <USkeleton class="h-32 w-full" />
        </div>
        <div class="space-y-2">
          <USkeleton class="h-4 w-24" />
          <USkeleton class="h-32 w-full" />
        </div>
      </div>
      <EmptyState
        v-else-if="detailError"
        variant="error"
        title="This request could not be loaded"
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
        <LogsDetailList :rows="meta" />
        <section class="space-y-2" aria-labelledby="api-request-body">
          <h3 id="api-request-body" class="text-sm font-semibold text-highlighted">Request body</h3>
          <JsonBlock
            v-if="hasBody(detail.requestBody)"
            :value="detail.requestBody"
            label="Request body"
          />
          <p v-else class="text-[13px] text-muted">No request body.</p>
        </section>
        <section class="space-y-2" aria-labelledby="api-response-body">
          <h3 id="api-response-body" class="text-sm font-semibold text-highlighted">Response</h3>
          <JsonBlock
            v-if="hasBody(detail.responseBody)"
            :value="detail.responseBody"
            label="Response body"
          />
          <p v-else class="text-[13px] text-muted">No response body was recorded.</p>
        </section>
      </div>
    </LogsDetailSlideover>
  </LogsPanel>
</template>
