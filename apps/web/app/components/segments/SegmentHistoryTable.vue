<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  SegmentMembershipChange,
  SegmentMembershipChangeKind,
  SegmentMembershipContact
} from '#shared/types/segments'

const props = defineProps<{ segmentId: string; synced: boolean | null }>()

const { page, pageSize, items, total, loading, error, refresh } =
  usePaginatedList<SegmentMembershipChange>(`/api/segments/${props.segmentId}/history`, {
    key: `segment-history-${props.segmentId}`
  })

const ULink = resolveComponent('ULink')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const CHANGE_BADGES = new Map<SegmentMembershipChangeKind, { status: string; label: string }>([
  ['entered', { status: 'active', label: 'Entered' }],
  ['exited', { status: 'disabled', label: 'Left' }]
])

function fullName(contact: SegmentMembershipContact): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ')
}

function contactCell(contact: SegmentMembershipContact | null) {
  if (!contact) return h('span', { class: 'text-muted' }, 'Deleted contact')

  return h('div', { class: 'min-w-0' }, [
    h(
      ULink,
      {
        to: `/contacts/${contact.id}`,
        class: 'block font-medium text-highlighted truncate hover:underline underline-offset-2'
      },
      () => contact.email
    ),
    fullName(contact) ? h('p', { class: 'text-muted truncate' }, fullName(contact)) : null
  ])
}

const columns: TableColumn<SegmentMembershipChange>[] = [
  {
    id: 'contact',
    header: 'Contact',
    cell: ({ row }) => contactCell(row.original.contact)
  },
  {
    accessorKey: 'change',
    header: 'Change',
    meta: { class: { th: 'w-28 sm:w-36', td: 'w-28 sm:w-36' } },
    cell: ({ row }) => h(StatusBadge, CHANGE_BADGES.get(row.original.change))
  },
  {
    accessorKey: 'at',
    header: 'When',
    meta: { class: { th: 'w-36', td: 'w-36 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.at })
  }
]

function onSelect(_event: Event, row: { original: SegmentMembershipChange }) {
  if (row.original.contact) void navigateTo(`/contacts/${row.original.contact.id}`)
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-col gap-4">
    <EmptyState
      v-if="error && !loading"
      variant="error"
      title="Couldn't load the membership history"
      :description="apiErrorMessage(error)"
      appearance="outline"
    >
      <UButton label="Retry" icon="i-lucide-rotate-cw" variant="outline" @click="() => refresh()" />
    </EmptyState>
    <UTable
      v-else-if="loading || items.length"
      :data="items"
      :columns="columns"
      :loading="loading"
      sticky
      :ui="tableUi"
      caption="Contacts that entered or left this segment"
      class="shrink-0"
      @select="onSelect"
    />
    <EmptyState
      v-else-if="synced === false"
      icon="i-lucide-history"
      title="No history yet"
      description="History starts after the first sync, within a few minutes."
      appearance="outline"
    />
    <EmptyState
      v-else
      icon="i-lucide-history"
      title="No membership changes yet"
      description="Contacts show up here when they enter or leave this segment."
      appearance="outline"
    />

    <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="change" />
  </div>
</template>
