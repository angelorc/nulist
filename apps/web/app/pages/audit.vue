<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { format, isToday, isYesterday } from 'date-fns'
import { z } from 'zod'
import type { PermissionRequest } from '#shared/auth/permissions'
import type { JsonValue } from '#shared/types/domain'
import type {
  AuditFacetKey,
  AuditFacets,
  AuditLogItem,
  FacetBucket,
  LogPeriod
} from '#shared/types/logs'
import type { FacetOption } from '~/components/facets/Group.vue'
import type { DetailRow } from '~/components/logs/DetailList.vue'
import type { DateRangeValue } from '~/utils/logLinks'
import { dateRangeQuerySchema, selectedEntrySchema } from '#shared/schemas/logs'

definePageMeta({ permission: { audit: ['read'] } })

useSeoMeta({ title: 'Audit log' })

const ACTOR = AUDIT_ACTORS

const ACTOR_BY_TYPE = new Map<string, { icon: string; label: string }>(Object.entries(ACTOR))

const DATE_PRESETS: LogPeriod[] = ['24h', '7d', '30d', '90d']

/** The page an audited entity lives on, and what the viewer needs to open it. */
interface EntityLink {
  to: (id: string) => string
  permission: PermissionRequest
}

const MEMBERS: EntityLink = { to: () => '/settings/members', permission: { member: ['read'] } }

/** Entity types (as services and the organization hooks record them) that have a page. */
const ENTITY_LINKS = new Map<string, EntityLink>([
  ['contact', { to: (id) => `/contacts/${id}`, permission: { contact: ['read'] } }],
  ['list', { to: (id) => `/lists/${id}`, permission: { list: ['read'] } }],
  ['segment', { to: (id) => `/segments/${id}`, permission: { segment: ['read'] } }],
  ['template', { to: (id) => `/templates/${id}`, permission: { template: ['read'] } }],
  ['broadcast', { to: (id) => `/broadcasts/${id}`, permission: { broadcast: ['read'] } }],
  ['webhook_endpoint', { to: (id) => `/webhooks/${id}`, permission: { webhook: ['read'] } }],
  ['message', { to: (id) => `/logs?tab=emails&id=${id}`, permission: { log: ['read'] } }],
  ['email', { to: (id) => `/logs?tab=emails&id=${id}`, permission: { log: ['read'] } }],
  ['import', { to: () => '/contacts/import', permission: { contact: ['import'] } }],
  ['domain', { to: () => '/settings/domains', permission: { domain: ['read'] } }],
  ['webhook_delivery', { to: () => '/webhooks', permission: { webhook: ['read'] } }],
  ['api_key', { to: () => '/settings/api-keys', permission: { apiKey: ['read'] } }],
  ['topic', { to: () => '/settings/topics', permission: { topic: ['read'] } }],
  ['suppression', { to: () => '/settings/suppressions', permission: { suppression: ['read'] } }],
  ['settings', { to: () => '/settings', permission: { settings: ['read'] } }],
  ['file', { to: () => '/files', permission: { file: ['read'] } }],
  [
    'organization',
    { to: () => '/settings/organization', permission: { organization: ['update'] } }
  ],
  ['user', MEMBERS],
  ['member', MEMBERS],
  ['invitation', MEMBERS]
])

/** A field-level diff as the audit logger records it. */
const fieldChangeSchema = z.strictObject({ from: z.json(), to: z.json() })

interface FieldChange {
  field: string
  from: JsonValue
  to: JsonValue
}

const { can } = useOrganization()

function entityLabel(type: string): string {
  if (type === 'api_key') return 'API key'
  const words = type.replace(/_/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

const shortId = (id: string) => (id.length > 12 ? `…${id.slice(-8)}` : id)

/** Filter values as the URL holds them: facet selections are comma-joined lists. */
type AuditFilters = {
  entityType?: string
  entityId?: string
  actorType?: string
  action?: string
  period?: string
  from?: string
  to?: string
}

const FACET_KEYS = ['actorType', 'entityType', 'action'] as const satisfies AuditFacetKey[]

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
} = usePaginatedList<AuditLogItem, AuditFilters>('/api/audit', {
  filters: {
    entityType: undefined,
    entityId: undefined,
    actorType: undefined,
    action: undefined,
    period: undefined,
    from: undefined,
    to: undefined
  }
})

const dateRange = computed<DateRangeValue>({
  get: () => {
    const parsed = dateRangeQuerySchema.safeParse({
      period: filters.period,
      from: filters.from,
      to: filters.to
    })

    return parsed.success ? parsed.data : {}
  },
  set: (value) => {
    Object.assign(filters, { period: value.period, from: value.from, to: value.to })
  }
})

const debouncedQ = refDebounced(q, 300)

const facetQuery = computed(() => LogLinks.query({ q: debouncedQ.value, ...filters }))

const {
  data: facetData,
  status: facetStatus,
  refresh: refreshFacets
} = useFetch<AuditFacets>('/api/audit/facets', { query: facetQuery, lazy: true })

const facetsLoading = computed(() => facetStatus.value === 'pending')

function facetOptions(
  key: AuditFacetKey,
  option: (bucket: FacetBucket) => Omit<FacetOption, 'value' | 'count'>
): FacetOption[] {
  return (facetData.value?.facets[key] ?? []).map((bucket) =>
    Object.assign({ value: bucket.value, count: bucket.count }, option(bucket))
  )
}

const actorOptions = computed(() =>
  facetOptions('actorType', (bucket) => {
    const actor = ACTOR_BY_TYPE.get(bucket.value)

    return { label: actor?.label ?? bucket.value, icon: actor?.icon }
  })
)

const entityOptions = computed(() =>
  facetOptions('entityType', (bucket) => ({ label: entityLabel(bucket.value) }))
)

const actionOptions = computed(() =>
  facetOptions('action', (bucket) => ({
    label: bucket.value,
    icon: auditVerb(bucket.value).icon
  }))
)

const selectedCount = (value: string | undefined) =>
  value ? value.split(',').filter(Boolean).length : 0

const activeCount = computed(
  () =>
    FACET_KEYS.reduce((sum, key) => sum + selectedCount(filters[key]), 0) +
    (filters.entityId ? 1 : 0) +
    (q.value ? 1 : 0)
)

function clearFacets() {
  q.value = ''
  Object.assign(filters, {
    entityType: undefined,
    entityId: undefined,
    actorType: undefined,
    action: undefined
  })
}

const entityScope = computed(() => {
  const id = filters.entityId

  if (!id) return undefined
  const types = filters.entityType?.split(',').filter(Boolean) ?? []
  const type = types.length === 1 ? `${entityLabel(types[0] ?? '')} ` : ''

  return `Entity: ${type}${shortId(id)}`
})

const filtersOpen = ref(false)

function refreshAll() {
  void refresh()
  void refreshFacets()
}

const route = useRoute()
const router = useRouter()

const selectedId = computed<string | undefined>({
  get: () => selectedEntrySchema.parse(route.query.id),
  set: (id) => router.replace({ query: { ...route.query, id } })
})

const {
  data: fetched,
  status: detailStatus,
  error: detailError,
  refresh: refreshDetail
} = useAsyncData(
  () => `audit-entry-${selectedId.value ?? 'none'}`,
  () => {
    const id = selectedId.value

    if (!id) return Promise.resolve(null)
    const url: string = `/api/audit/${id}`

    return $fetch<AuditLogItem>(url)
  },
  { server: false }
)

/** The row already holds the full entry, so the panel fills instantly; the fetch covers deep links. */
const entry = computed(
  () => fetched.value ?? items.value.find((i) => String(i.id) === selectedId.value) ?? null
)

const { dateTime } = useFormat()

interface DayGroup {
  key: string
  label: string
  entries: AuditLogItem[]
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'

  if (isYesterday(date)) return 'Yesterday'

  return format(date, 'EEEE, d MMMM')
}

const groups = computed<DayGroup[]>(() => {
  const byDay = new Map<string, DayGroup>()

  for (const record of items.value) {
    const date = new Date(record.createdAt)
    const key = format(date, 'yyyy-MM-dd')
    const group = byDay.get(key) ?? { key, label: dayLabel(date), entries: [] }

    group.entries.push(record)
    byDay.set(key, group)
  }

  return [...byDay.values()]
})

const time = (value: string) => format(new Date(value), 'HH:mm')

function select(record: AuditLogItem) {
  selectedId.value = String(record.id)
}

const rowIds = computed(() => items.value.map((i) => String(i.id)))

/** Field-level diffs (`{ from, to }`) render as a table; anything else the action recorded renders as data. */
const changes = computed(() => {
  const diff: FieldChange[] = []
  const other: [string, JsonValue | undefined][] = []

  for (const [field, value] of Object.entries(entry.value?.changes ?? {})) {
    const change = fieldChangeSchema.safeParse(value)

    if (change.success) diff.push({ field, from: change.data.from, to: change.data.to })
    else other.push([field, value])
  }

  return { diff, data: other.length ? Object.fromEntries(other) : null }
})

function display(value: JsonValue): string {
  if (value === null || value === '') return ''

  return value instanceof Object ? JSON.stringify(value) : String(value)
}

/** Tint of a diff value: what was removed, what was added. */
const DIFF_TONE = {
  from: 'text-error bg-error/10',
  to: 'text-success bg-success/10'
} as const

/** A before/after value of the diff table, or a muted "empty". */
function diffValue(value: JsonValue, side: keyof typeof DIFF_TONE) {
  const text = display(value)

  if (!text) return h('span', { class: 'text-muted italic' }, 'empty')

  return h(
    'span',
    {
      class: [
        'w-fit max-w-full font-mono text-xs wrap-anywhere line-clamp-4 rounded-sm px-1 py-0.5',
        DIFF_TONE[side]
      ],
      title: text
    },
    text
  )
}

const diffColumns: TableColumn<FieldChange>[] = [
  {
    accessorKey: 'field',
    header: 'Field',
    meta: { class: { th: 'w-28', td: 'w-28 align-top whitespace-normal' } },
    cell: ({ row }) =>
      h('span', { class: 'font-mono text-xs text-highlighted break-words' }, row.original.field)
  },
  {
    accessorKey: 'from',
    header: 'Before',
    meta: { class: { td: 'align-top whitespace-normal' } },
    cell: ({ row }) => diffValue(row.original.from, 'from')
  },
  {
    accessorKey: 'to',
    header: 'After',
    meta: { class: { td: 'align-top whitespace-normal' } },
    cell: ({ row }) => diffValue(row.original.to, 'to')
  }
]

/** The entity's page, when it has one and the viewer may open it. */
const entityLink = computed(() => {
  const e = entry.value
  const link = e?.entityId ? ENTITY_LINKS.get(e.entityType) : undefined

  if (!e?.entityId || !link || !can(link.permission)) return undefined

  return link.to(e.entityId)
})

function actorDescription(e: AuditLogItem): string {
  const kind = ACTOR[e.actorType]?.label ?? e.actorType

  if (!e.actorLabel || e.actorLabel === kind) return kind

  return `${e.actorLabel} (${e.actorType === 'api_key' ? kind : kind.toLowerCase()})`
}

const requestRows = computed<DetailRow[]>(() => {
  const e = entry.value

  if (!e) return []

  return [
    { label: 'Time', value: dateTime(e.createdAt) },
    { label: 'Actor', value: actorDescription(e) },
    { label: 'Actor ID', value: e.actorId, copy: true },
    { label: 'Entity', value: entityLabel(e.entityType), to: entityLink.value },
    { label: 'Entity ID', value: e.entityId, copy: true },
    { label: 'IP address', value: e.ip, mono: true },
    { label: 'User agent', value: e.userAgent, mono: true },
    { label: 'Entry ID', value: String(e.id), copy: true }
  ]
})

function filterByEntity() {
  const e = entry.value

  if (!e?.entityId) return
  filters.entityType = e.entityType
  filters.entityId = e.entityId
}
</script>

<template>
  <FacetsPanel
    id="audit-facets"
    v-model:open="filtersOpen"
    :active="activeCount"
    @clear="clearFacets"
  >
    <UInput
      v-model="q"
      icon="i-lucide-search"
      placeholder="Search actions, actors…"
      size="sm"
      class="w-full"
      aria-label="Search the audit log"
    >
      <template #trailing>
        <UKbd v-if="!q" value="/" class="hidden lg:inline-flex" />
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
    <div v-if="entityScope" class="flex flex-wrap gap-1.5">
      <UButton
        :label="entityScope"
        trailing-icon="i-lucide-x"
        color="neutral"
        variant="outline"
        size="sm"
        class="max-w-full"
        :ui="{ label: 'truncate' }"
        :aria-label="`Remove filter entity ${filters.entityId}`"
        @click="filters.entityId = undefined"
      />
    </div>
    <FacetsGroup
      v-model="filters.actorType"
      title="Actor"
      :items="actorOptions"
      :loading="facetsLoading"
    />
    <FacetsGroup
      v-model="filters.entityType"
      title="Entity"
      :items="entityOptions"
      :loading="facetsLoading"
    />
    <FacetsGroup
      v-model="filters.action"
      title="Action"
      :items="actionOptions"
      :loading="facetsLoading"
    />
  </FacetsPanel>

  <UDashboardPanel id="audit">
    <template #header>
      <UDashboardNavbar title="Audit log">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <span class="hidden md:inline text-[13px] text-muted truncate">
            Who changed what, when and from where
          </span>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar :ui="{ right: 'ms-auto gap-1.5' }">
        <template #right>
          <DateRangePicker v-model="dateRange" :presets="DATE_PRESETS" any-time size="sm" />
          <FacetsButton v-model:open="filtersOpen" :active="activeCount" size="sm" />
          <UTooltip text="Refresh">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Refresh the audit log"
              :loading="loading"
              @click="refreshAll"
            />
          </UTooltip>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !items.length"
        variant="error"
        title="The audit log could not be loaded"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          @click="() => refresh()"
        />
      </EmptyState>
      <div
        v-else-if="loading && !items.length"
        class="space-y-2"
        aria-busy="true"
        aria-label="Loading the audit log"
      >
        <USkeleton class="h-4 w-24" />
        <USkeleton v-for="n in 8" :key="n" class="h-14 w-full" />
      </div>
      <ClientOnly v-else-if="items.length">
        <template #fallback>
          <div class="space-y-2" aria-busy="true" aria-label="Loading the audit log">
            <USkeleton class="h-4 w-24" />
            <USkeleton v-for="n in 8" :key="n" class="h-14 w-full" />
          </div>
        </template>
        <div
          class="space-y-6 shrink-0 transition-opacity"
          :class="loading && 'opacity-60'"
          :aria-busy="loading || undefined"
        >
          <section v-for="group in groups" :key="group.key" :aria-labelledby="`day-${group.key}`">
            <h2
              :id="`day-${group.key}`"
              class="mb-2 flex items-center gap-2 text-xs font-medium text-muted"
            >
              {{ group.label }}
              <span class="tabular-nums text-dimmed">{{ group.entries.length }}</span>
            </h2>
            <ul class="rounded-lg ring ring-default divide-y divide-default overflow-hidden">
              <li v-for="entry in group.entries" :key="entry.id">
                <UButton
                  variant="ghost"
                  block
                  class="rounded-none justify-start gap-3 px-3 py-2.5 text-left font-normal hover:bg-elevated/50"
                  :class="selectedId === String(entry.id) && 'bg-elevated/60'"
                  @click="select(entry)"
                >
                  <span
                    class="grid size-8 shrink-0 place-items-center rounded-full bg-elevated ring ring-default"
                    aria-hidden="true"
                  >
                    <UIcon
                      :name="auditVerb(entry.action).icon"
                      class="size-4"
                      :class="auditVerb(entry.action).tone ?? 'text-muted'"
                    />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-highlighted">{{ entry.summary }}</span>
                    <span class="flex items-center gap-1.5 min-w-0 text-xs text-muted">
                      <UIcon
                        :name="ACTOR[entry.actorType]?.icon ?? 'i-lucide-cpu'"
                        class="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="truncate">{{
                        entry.actorLabel ?? ACTOR[entry.actorType]?.label
                      }}</span>
                      <span aria-hidden="true">·</span>
                      <span class="shrink-0">{{ entityLabel(entry.entityType) }}</span>
                      <span class="hidden sm:inline" aria-hidden="true">·</span>
                      <span class="hidden sm:inline truncate font-mono">{{ entry.action }}</span>
                    </span>
                  </span>
                  <UTooltip :text="dateTime(entry.createdAt)">
                    <time
                      :datetime="entry.createdAt"
                      class="shrink-0 text-xs text-muted tabular-nums"
                      >{{ time(entry.createdAt) }}</time
                    >
                  </UTooltip>
                </UButton>
              </li>
            </ul>
          </section>
        </div>
      </ClientOnly>
      <EmptyState
        v-else-if="isFiltered"
        variant="no-results"
        title="No entries match your filters"
        description="Try another search term, filter or time range."
      >
        <UButton label="Clear filters" variant="outline" @click="clearFilters" />
      </EmptyState>
      <EmptyState
        v-else
        icon="i-lucide-shield-check"
        title="No activity recorded yet"
        description="Creating, editing or deleting lists, contacts, templates, broadcasts and settings adds an entry here."
      />

      <TableFooter
        v-model:page="page"
        :total="total"
        :page-size="pageSize"
        noun="entry"
        noun-plural="entries"
      />

      <LogsDetailSlideover
        v-model:id="selectedId"
        :ids="rowIds"
        :title="entry?.summary ?? 'Audit entry'"
      >
        <template v-if="entry" #meta>
          <UBadge :label="entry.action" variant="outline" class="font-mono" />
          <span class="inline-flex items-center gap-1 text-muted">
            <UIcon :name="ACTOR[entry.actorType]?.icon ?? 'i-lucide-cpu'" class="size-3.5" />
            {{ entry.actorLabel ?? ACTOR[entry.actorType]?.label }}
          </span>
        </template>

        <div
          v-if="!entry && detailStatus === 'pending'"
          class="space-y-6"
          aria-busy="true"
          aria-label="Loading entry"
        >
          <div class="space-y-2">
            <USkeleton class="h-4 w-20" />
            <USkeleton class="h-28 w-full" />
          </div>
          <div class="space-y-2">
            <USkeleton class="h-4 w-20" />
            <USkeleton class="h-64 w-full" />
          </div>
        </div>
        <EmptyState
          v-else-if="!entry && detailError"
          variant="error"
          title="This entry could not be loaded"
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
        <div v-else-if="entry" class="space-y-6">
          <section class="space-y-2" aria-labelledby="audit-changes">
            <h3 id="audit-changes" class="text-sm font-semibold text-highlighted">Changes</h3>
            <UTable
              v-if="changes.diff.length"
              :data="changes.diff"
              :columns="diffColumns"
              caption="Field changes"
              :ui="tableUi"
            />
            <JsonBlock v-if="changes.data" :value="changes.data" label="Recorded data" />
            <p v-if="!changes.diff.length && !changes.data" class="text-[13px] text-muted">
              This action did not record field changes.
            </p>
          </section>

          <section class="space-y-2" aria-labelledby="audit-request">
            <div class="flex items-center justify-between gap-2">
              <h3 id="audit-request" class="text-sm font-semibold text-highlighted">Request</h3>
              <UButton
                v-if="entry.entityId && filters.entityId !== entry.entityId"
                label="All activity for this entity"
                icon="i-lucide-history"
                variant="link"
                size="xs"
                @click="filterByEntity"
              />
            </div>
            <LogsDetailList :rows="requestRows" />
          </section>
        </div>
      </LogsDetailSlideover>
    </template>
  </UDashboardPanel>
</template>
