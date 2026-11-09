<script setup lang="ts">
import { format } from 'date-fns'
import type { DropdownMenuItem, TableColumn, TableRow, TabsItem } from '@nuxt/ui'
import type {
  BroadcastDto,
  BroadcastListItem,
  BroadcastTab,
  BroadcastTabCounts
} from '#shared/types/broadcasts'

definePageMeta({ permission: { broadcast: ['read'] } })

useSeoMeta({ title: 'Broadcasts' })

const { can } = useOrganization()
const canCreate = computed(() => can({ broadcast: ['create'] }))
const canEdit = computed(() => can({ broadcast: ['update'] }))
const canDelete = computed(() => can({ broadcast: ['delete'] }))

interface TabOption {
  label: string
  value: BroadcastTab
}

const TABS: TabOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Sending', value: 'sending' },
  { label: 'Sent', value: 'sent' },
  { label: 'Cancelled', value: 'cancelled' }
]

const route = useRoute()
const router = useRouter()
const { number, percent, dateTime } = useFormat()

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
} = usePaginatedList<BroadcastListItem, { status?: string }>('/api/broadcasts', {
  filters: { status: undefined }
})

const { data: counts, refresh: refreshCounts } =
  useFetch<BroadcastTabCounts>('/api/broadcasts/counts')

function isTab(value: string | undefined): value is BroadcastTab {
  return TABS.some((t) => t.value === value)
}

const tab = computed<BroadcastTab>({
  get: () => (isTab(filters.status) ? filters.status : 'all'),
  set: (value) => {
    filters.status = value === 'all' ? undefined : value
  }
})

const tabItems = computed<TabsItem[]>(() =>
  TABS.map((t) => {
    const count = t.value === 'all' ? 0 : (counts.value?.[t.value] ?? 0)

    return {
      label: t.label,
      value: t.value,
      badge: count
        ? { label: number(count), color: 'neutral', variant: 'subtle', class: 'tabular-nums' }
        : undefined
    }
  })
)

const hasAny = computed(() => (counts.value?.all ?? 0) > 0)

// Live status while something is sending or about to start.
const active = computed(() =>
  items.value.some(
    (b) =>
      b.status === 'sending' ||
      (b.status === 'scheduled' &&
        b.scheduledAt &&
        new Date(b.scheduledAt).getTime() < Date.now() + 60_000)
  )
)

const { pause, resume } = useIntervalFn(
  () => {
    void refresh()
    void refreshCounts()
  },
  5000,
  { immediate: false }
)

watch(active, (value) => (value ? resume() : pause()), { immediate: true })

// Create ------------------------------------------------------------------------
const { run: create, pending: creating } = useApiAction(
  () => $fetch<BroadcastDto>('/api/broadcasts', { method: 'POST', body: {} }),
  { error: 'Broadcast not created' }
)

async function newBroadcast() {
  const broadcast = await create()

  if (broadcast) await navigateTo(`/broadcasts/${broadcast.id}`)
}

// ⌘K "New broadcast" and dashboard shortcuts land here with ?new=1
onMounted(() => {
  if (!route.query.new) return
  void router.replace({ query: { ...route.query, new: undefined } })

  if (canCreate.value) void newBroadcast()
})

// Row actions -----------------------------------------------------------------
const confirm = useConfirm()

const { run: duplicate } = useApiAction(
  (id: string) => $fetch<BroadcastDto>(`/api/broadcasts/${id}/duplicate`, { method: 'POST' }),
  { success: 'Broadcast duplicated' }
)

async function onDuplicate(row: BroadcastListItem) {
  const copy = await duplicate(row.id)

  if (copy) await navigateTo(`/broadcasts/${copy.id}`)
}

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/broadcasts/${id}`, { method: 'DELETE' }),
  { success: 'Broadcast deleted' }
)

async function onDelete(row: BroadcastListItem) {
  const sent = row.status === 'sent' || row.stats.recipients > 0

  const ok = await confirm({
    title: `Delete "${row.name}"?`,
    description: sent
      ? `Its report and the email log of its ${number(row.stats.recipients)} recipients are deleted too. This can't be undone.`
      : "This can't be undone.",
    confirmLabel: 'Delete broadcast',
    danger: true
  })

  if (ok && (await remove(row.id)) !== undefined) {
    await Promise.all([refresh(), refreshCounts()])
  }
}

/** Row menu: open, then duplicate and delete when the member's role allows them. */
function rowActions(row: BroadcastListItem): DropdownMenuItem[][] {
  const draft = row.status === 'draft'
  const editable = draft && canEdit.value

  const open: DropdownMenuItem[] = [
    {
      label: editable ? 'Edit' : draft ? 'View' : 'View report',
      icon: editable ? 'i-lucide-pencil' : draft ? 'i-lucide-eye' : 'i-lucide-chart-column',
      to: `/broadcasts/${row.id}`
    }
  ]

  if (canCreate.value)
    open.push({ label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => onDuplicate(row) })

  const groups = [open]

  if (isBroadcastDeletable(row) && canDelete.value) {
    groups.push([
      { label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => onDelete(row) }
    ])
  }

  return groups
}

interface DateLabel {
  label: string
  date: string | null
}

function when(row: BroadcastListItem): DateLabel {
  if (row.status === 'draft') return { label: 'Edited', date: row.updatedAt }

  if (row.status === 'scheduled')
    return { label: row.scheduledAt ? 'Scheduled' : 'Starting', date: row.scheduledAt }

  if (row.status === 'sent') return { label: 'Sent', date: row.completedAt ?? row.startedAt }

  if (row.status === 'sending' || row.status === 'paused')
    return { label: 'Started', date: row.startedAt }

  return { label: 'Stopped', date: row.completedAt ?? row.updatedAt }
}

const ULink = resolveComponent('ULink')
const UTooltip = resolveComponent('UTooltip')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const hasStats = (row: BroadcastListItem) => row.stats.sent > 0

/** A rate with its absolute count in a tooltip (and for screen readers). */
const rateCell = (row: BroadcastListItem, value: number, label: string) =>
  hasStats(row)
    ? h(UTooltip, { text: label }, () =>
        h('span', [percent(value), h('span', { class: 'sr-only' }, `, ${label}`)])
      )
    : emptyCell()

const numeric = (width: string, visibility: string) => ({
  class: {
    th: `${width} ${visibility} text-right`,
    td: `${width} ${visibility} text-right tabular-nums`
  }
})

const columns: TableColumn<BroadcastListItem>[] = [
  {
    accessorKey: 'name',
    header: 'Broadcast',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/broadcasts/${row.original.id}`,
            class:
              'block truncate font-medium text-highlighted hover:text-highlighted hover:underline underline-offset-2'
          },
          () => row.original.name
        ),
        h('p', { class: 'text-muted truncate' }, row.original.subject || 'No subject yet')
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    id: 'recipients',
    header: 'Recipients',
    meta: numeric('w-28', 'hidden md:table-cell'),
    cell: ({ row }) => {
      const value = row.original.stats.recipients || row.original.recipientCount

      return value ? h('span', { class: 'text-highlighted' }, number(value)) : emptyCell()
    }
  },
  {
    id: 'openRate',
    header: 'Opens',
    meta: numeric('w-24', 'hidden lg:table-cell'),
    cell: ({ row }) =>
      rateCell(
        row.original,
        row.original.stats.openRate,
        `${number(row.original.stats.opened)} unique opens (estimate)`
      )
  },
  {
    id: 'clickRate',
    header: 'Clicks',
    meta: numeric('w-24', 'hidden lg:table-cell'),
    cell: ({ row }) =>
      rateCell(
        row.original,
        row.original.stats.clickRate,
        `${number(row.original.stats.clicked)} unique clicks`
      )
  },
  {
    id: 'when',
    header: 'Date',
    meta: {
      class: { th: 'w-44 hidden sm:table-cell', td: 'w-44 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => {
      const { label, date } = when(row.original)

      if (!date) return label === 'Starting' ? h('span', 'Starting now') : emptyCell()

      if (new Date(date).getTime() > Date.now()) {
        return h(UTooltip, { text: dateTime(date) }, () =>
          h(
            'span',
            { class: 'tabular-nums whitespace-nowrap' },
            `${label} ${format(new Date(date), 'EEE d MMM, HH:mm')}`
          )
        )
      }

      return h('span', { class: 'whitespace-nowrap' }, [`${label} `, h(TimeAgo, { date })])
    }
  },
  rowActionsColumn({ items: rowActions, label: (row) => `Actions for ${row.name}` })
]

function onSelect(_event: Event, row: TableRow<BroadcastListItem>) {
  void navigateTo(`/broadcasts/${row.original.id}`)
}

// Keyboard: `n` creates (when the role allows it), `/` focuses the search.
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts(
  computed(() => ({
    n: canCreate.value ? () => void newBroadcast() : false,
    '/': () => searchInput.value?.inputRef?.focus()
  }))
)
</script>

<template>
  <UDashboardPanel id="broadcasts">
    <template #header>
      <UDashboardNavbar title="Broadcasts">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <Can
            v-slot="{ allowed }"
            :permission="{ broadcast: ['create'] }"
            explain="You don't have permission to create broadcasts"
          >
            <UTooltip text="New broadcast" :kbds="['n']" :disabled="!allowed">
              <UButton
                label="New broadcast"
                icon="i-lucide-plus"
                :loading="creating"
                :disabled="!allowed"
                @click="newBroadcast"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar v-if="hasAny || isFiltered" :ui="{ left: 'min-w-0 flex-1' }">
        <template #left>
          <UTabs
            v-model="tab"
            :items="tabItems"
            :content="false"
            size="sm"
            class="hidden md:flex min-w-0"
            aria-label="Filter by status"
          />
          <USelect
            v-model="tab"
            :items="TABS"
            size="sm"
            class="md:hidden w-36"
            aria-label="Filter by status"
          />
        </template>
        <template #right>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search name or subject…"
            size="sm"
            class="w-44 sm:w-64"
            aria-label="Search broadcasts"
          >
            <template v-if="q" #trailing>
              <UButton
                icon="i-lucide-x"
                size="xs"
                variant="link"
                aria-label="Clear search"
                @click="q = ''"
              />
            </template>
          </UInput>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !items.length"
        variant="error"
        appearance="outline"
        title="Couldn't load broadcasts"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          @click="() => refresh()"
        />
      </EmptyState>

      <template v-else-if="loading || items.length">
        <UTable
          :data="items"
          :columns="columns"
          :loading="loading"
          sticky
          :ui="tableUi"
          class="shrink-0"
          @select="onSelect"
        >
          <template #loading>
            <div class="space-y-3 py-2" aria-busy="true">
              <USkeleton v-for="i in 8" :key="i" class="h-4 w-full" />
            </div>
          </template>
        </UTable>
        <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="broadcast" />
      </template>

      <EmptyState
        v-else-if="isFiltered || tab !== 'all'"
        variant="no-results"
        appearance="outline"
        title="No broadcasts match your filters"
        description="Try another status or search term."
      >
        <UButton label="Clear filters" variant="outline" @click="clearFilters" />
      </EmptyState>

      <EmptyState
        v-else-if="canCreate"
        appearance="outline"
        icon="i-lucide-send"
        title="Send your first broadcast"
        description="Pick an audience, write a subject, choose a template and send it, now or later."
      >
        <UButton
          label="New broadcast"
          icon="i-lucide-plus"
          :loading="creating"
          @click="newBroadcast"
        />
      </EmptyState>

      <EmptyState
        v-else
        appearance="outline"
        icon="i-lucide-send"
        title="No broadcasts yet"
        description="Broadcasts your team creates appear here."
      />
    </template>
  </UDashboardPanel>
</template>
