<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/** Paginated contacts currently matching a saved segment. */
const props = defineProps<{ segmentId: string }>()

interface SegmentContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: string
  createdAt: string
}

const { page, pageSize, q, items, total, loading, error, refresh, isFiltered, clearFilters } =
  usePaginatedList<SegmentContact>(`/api/segments/${props.segmentId}/contacts`, {
    key: `segment-contacts-${props.segmentId}`
  })

const ULink = resolveComponent('ULink')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

function fullName(contact: SegmentContact): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ')
}

const columns: TableColumn<SegmentContact>[] = [
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/contacts/${row.original.id}`,
            class: 'block font-medium text-highlighted truncate hover:underline underline-offset-2'
          },
          () => row.original.email
        ),
        fullName(row.original)
          ? h('p', { class: 'text-muted truncate' }, fullName(row.original))
          : null
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-28 sm:w-36', td: 'w-28 sm:w-36' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'createdAt',
    header: 'Added',
    meta: {
      class: { th: 'w-36 hidden sm:table-cell', td: 'w-36 text-muted hidden sm:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: { original: SegmentContact }) {
  void navigateTo(`/contacts/${row.original.id}`)
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-col gap-4">
    <UInput
      v-model="q"
      icon="i-lucide-search"
      placeholder="Search email…"
      aria-label="Search matching contacts"
      class="w-full sm:w-64"
    />

    <EmptyState
      v-if="error && !loading"
      variant="error"
      title="Couldn't load matching contacts"
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
      caption="Contacts matching this segment"
      class="shrink-0"
      @select="onSelect"
    />
    <EmptyState
      v-else-if="isFiltered"
      variant="no-results"
      title="No matching contacts for this search"
      description="Try a different email or clear the search."
      appearance="outline"
    >
      <UButton label="Clear search" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      icon="i-lucide-filter"
      title="No contacts match this segment yet"
      description="Contacts appear here automatically as soon as they meet the conditions."
      appearance="outline"
    />

    <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="contact" />
  </div>
</template>
