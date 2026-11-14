<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { BroadcastRecipient, BroadcastRecipientFilter } from '#shared/types/broadcasts'
import type { Paginated } from '#shared/types/domain'

/**
 * Paginated recipients of a broadcast; a row opens its email log entry when the
 * member's role can read logs.
 */
const props = defineProps<{ broadcastId: string; live?: boolean }>()

const { can } = useOrganization()
const canOpenLog = computed(() => can({ log: ['read'] }))

const FILTERS: { label: string; value: BroadcastRecipientFilter | 'all' }[] = [
  { label: 'All recipients', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Sent', value: 'sent' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Opened', value: 'opened' },
  { label: 'Clicked', value: 'clicked' },
  { label: 'Bounced', value: 'bounced' },
  { label: 'Complained', value: 'complained' },
  { label: 'Failed', value: 'failed' },
  { label: 'Suppressed', value: 'suppressed' },
  { label: 'Cancelled', value: 'cancelled' }
]

const pageSize = 25
const page = ref(1)
const q = ref('')
const status = ref<BroadcastRecipientFilter | 'all'>('all')
const debouncedQ = refDebounced(q, 300)

watch([debouncedQ, status], () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  q: debouncedQ.value || undefined,
  status: status.value === 'all' ? undefined : status.value
}))

const url = computed(() => `/api/broadcasts/${props.broadcastId}/recipients`)

const {
  data,
  status: fetchStatus,
  error,
  refresh
} = useFetch<Paginated<BroadcastRecipient>>(url, {
  query,
  server: false,
  default: () => ({ items: [], total: 0, page: 1, pageSize })
})

const { pause, resume } = useIntervalFn(() => void refresh(), 5000, { immediate: false })

watch(
  () => props.live,
  (value) => (value ? resume() : pause()),
  { immediate: true }
)

const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const loading = computed(() => fetchStatus.value === 'pending' && !items.value.length)
const isFiltered = computed(() => !!debouncedQ.value || status.value !== 'all')

function clearFilters() {
  q.value = ''
  status.value = 'all'
}

/** The recipient's message in the email log (members who may read logs). */
const logLocation = (messageId: string) => LogLinks.emails({ id: messageId })

const emailClass = 'block max-w-full truncate font-mono text-xs text-highlighted'

const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')
const UIcon = resolveComponent('UIcon')
const ULink = resolveComponent('ULink')
const UTooltip = resolveComponent('UTooltip')

/** An engagement mark: icon and count, the full sentence in a tooltip and for screen readers. */
function mark(icon: string, count: number, verb: string) {
  const text = `${verb} ${count}×`

  return h(UTooltip, { text }, () =>
    h('span', { class: 'inline-flex items-center gap-1' }, [
      h(UIcon, { name: icon, class: 'size-3.5 text-primary', 'aria-hidden': 'true' }),
      h('span', { class: 'tabular-nums', 'aria-hidden': 'true' }, String(count)),
      h('span', { class: 'sr-only' }, text)
    ])
  )
}

function engagement(row: BroadcastRecipient) {
  const marks = [
    row.openedAt ? mark('i-lucide-mail-open', row.openCount, 'Opened') : null,
    row.clickedAt ? mark('i-lucide-mouse-pointer-click', row.clickCount, 'Clicked') : null
  ].filter((node) => node !== null)

  return marks.length ? h('div', { class: 'flex items-center gap-3' }, marks) : emptyCell()
}

const columns: TableColumn<BroadcastRecipient>[] = [
  {
    accessorKey: 'email',
    header: 'Recipient',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        canOpenLog.value
          ? h(
              ULink,
              {
                to: logLocation(row.original.messageId),
                class: `${emailClass} hover:text-highlighted hover:underline underline-offset-2`
              },
              () => row.original.email
            )
          : h('p', { class: emailClass }, row.original.email),
        row.original.firstName || row.original.lastName
          ? h(
              'p',
              { class: 'text-muted truncate' },
              [row.original.firstName, row.original.lastName].filter(Boolean).join(' ')
            )
          : null
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) =>
      row.original.error
        ? h(UTooltip, { text: row.original.error }, () =>
            h('span', { class: 'inline-flex' }, [
              h(StatusBadge, { status: row.original.status }),
              h('span', { class: 'sr-only' }, `: ${row.original.error}`)
            ])
          )
        : h(StatusBadge, { status: row.original.status })
  },
  {
    id: 'engagement',
    header: 'Engagement',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => engagement(row.original)
  },
  {
    accessorKey: 'sentAt',
    header: 'Sent',
    meta: {
      class: { th: 'w-32 hidden md:table-cell', td: 'w-32 hidden md:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.sentAt })
  }
]

function onSelect(_event: Event, row: TableRow<BroadcastRecipient>) {
  void navigateTo(logLocation(row.original.messageId))
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search email…"
        class="w-full sm:w-64"
        aria-label="Search recipients"
      />
      <USelect
        v-model="status"
        :items="FILTERS"
        class="w-full sm:w-44"
        aria-label="Filter by status"
      />
    </div>

    <EmptyState
      v-if="error && !items.length"
      variant="error"
      appearance="outline"
      title="Couldn't load recipients"
      :description="apiErrorMessage(error)"
    >
      <UButton label="Retry" icon="i-lucide-rotate-cw" variant="outline" @click="() => refresh()" />
    </EmptyState>
    <template v-else-if="loading || items.length">
      <UTable
        :data="items"
        :columns="columns"
        :loading="fetchStatus === 'pending'"
        sticky
        :ui="tableUi"
        class="shrink-0"
        :on-select="canOpenLog ? onSelect : undefined"
      >
        <template #loading>
          <div class="space-y-3 py-2" aria-busy="true">
            <USkeleton v-for="i in 8" :key="i" class="h-4 w-full" />
          </div>
        </template>
      </UTable>
      <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="recipient" />
    </template>
    <EmptyState
      v-else-if="isFiltered"
      variant="no-results"
      appearance="outline"
      title="No recipients match your filters"
      description="Try another status or search term."
    >
      <UButton label="Clear filters" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      appearance="outline"
      icon="i-lucide-users"
      title="No recipients yet"
      description="Recipients appear here once sending starts."
    />
  </div>
</template>
