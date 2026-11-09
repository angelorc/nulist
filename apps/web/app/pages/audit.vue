<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import { z } from 'zod'
import type { PermissionRequest } from '#shared/auth/permissions'
import type { JsonValue } from '#shared/types/domain'
import type { ActorType, AuditLogItem } from '#shared/types/logs'
import type { DetailRow } from '~/components/logs/DetailList.vue'
import { selectedEntrySchema } from '#shared/schemas/logs'

definePageMeta({ permission: { audit: ['read'] } })

useSeoMeta({ title: 'Audit log' })

const ACTOR: Record<ActorType, { icon: string; label: string }> = {
  user: { icon: 'i-lucide-user', label: 'Member' },
  api_key: { icon: 'i-lucide-key-round', label: 'API key' },
  system: { icon: 'i-lucide-cpu', label: 'System' }
}

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

const { data: entityTypes } = useFetch<string[]>('/api/audit/entity-types', { default: () => [] })

const entityItems = computed(() => [
  { label: 'All entities', value: 'all' },
  ...entityTypes.value.map((type) => ({ label: entityLabel(type), value: type }))
])

/** Filter values as the select and the entity link hold them (`all` means no filter). */
type AuditFilters = { entityType?: string; entityId?: string }

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
  filters: { entityType: undefined, entityId: undefined }
})

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

const UAvatar = resolveComponent('UAvatar')
const UTooltip = resolveComponent('UTooltip')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<AuditLogItem>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Time',
    meta: { class: { th: 'w-28', td: 'w-28 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  },
  {
    id: 'actor',
    header: 'Actor',
    meta: { class: { th: 'w-52 hidden md:table-cell', td: 'w-52 hidden md:table-cell' } },
    cell: ({ row }) => {
      const actor = ACTOR[row.original.actorType] ?? ACTOR.system

      return h('div', { class: 'flex items-center gap-2 min-w-0' }, [
        h(UTooltip, { text: actor.label }, () => h(UAvatar, { icon: actor.icon, size: 'xs' })),
        h('span', { class: 'sr-only' }, `${actor.label}:`),
        h('span', { class: 'truncate text-default' }, row.original.actorLabel ?? actor.label)
      ])
    }
  },
  {
    accessorKey: 'action',
    header: 'Action',
    meta: { class: { th: 'w-48 hidden sm:table-cell', td: 'w-48 hidden sm:table-cell' } },
    cell: ({ row }) =>
      h('span', { class: 'block truncate font-mono text-xs text-highlighted' }, row.original.action)
  },
  {
    accessorKey: 'summary',
    header: 'Summary',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'block truncate text-highlighted', title: row.original.summary },
        row.original.summary
      )
  },
  {
    id: 'entity',
    header: 'Entity',
    meta: { class: { th: 'w-44 hidden lg:table-cell', td: 'w-44 hidden lg:table-cell' } },
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'truncate text-default' }, entityLabel(row.original.entityType)),
        row.original.entityId
          ? h(
              'p',
              { class: 'truncate font-mono text-xs text-muted', title: row.original.entityId },
              shortId(row.original.entityId)
            )
          : null
      ])
  }
]

function onSelect(_event: Event, row: TableRow<AuditLogItem>) {
  selectedId.value = String(row.original.id)
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

const search = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts({ '/': () => search.value?.inputRef?.focus() })
</script>

<template>
  <UDashboardPanel id="audit">
    <template #header>
      <UDashboardNavbar title="Audit log">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'flex-wrap', right: 'ms-auto' }"
      >
        <template #left>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search actions, actors or summaries…"
            size="sm"
            class="w-full sm:w-72"
            aria-label="Search the audit log"
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
            v-model="filters.entityType"
            :items="entityItems"
            placeholder="All entities"
            size="sm"
            class="w-44"
            aria-label="Filter by entity type"
          />
          <UButton
            v-if="filters.entityId"
            :label="shortId(filters.entityId)"
            trailing-icon="i-lucide-x"
            variant="outline"
            size="sm"
            class="font-mono"
            :aria-label="`Remove filter entity ${filters.entityId}`"
            @click="filters.entityId = undefined"
          />
        </template>
        <template #right>
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
              aria-label="Refresh the audit log"
              :loading="loading"
              @click="() => refresh()"
            />
          </UTooltip>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">
        A record of every change made in nulist or through the API: who made it, what changed and
        where the request came from.
      </p>

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
        title="No entries match your filters"
        description="Try another search term or entity type."
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
            <JsonBlock
              v-if="changes.data"
              :value="changes.data"
              label="Recorded data"
              max-height="20rem"
            />
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
