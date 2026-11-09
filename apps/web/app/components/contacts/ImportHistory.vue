<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ImportSummary } from '#shared/types/contacts'
import type { ImportMode } from '#shared/types/domain'

/** Recent imports; selecting one shows its progress and result. */
defineProps<{ imports: ImportSummary[]; loading?: boolean; activeId?: string | null }>()

const emit = defineEmits<{ select: [id: string] }>()

const { number } = useFormat()
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const MODE_LABELS = {
  skip: 'Skip existing',
  merge: 'Merge',
  overwrite: 'Overwrite'
} as const satisfies Record<ImportMode, string>

const columns: TableColumn<ImportSummary>[] = [
  {
    accessorKey: 'fileName',
    header: 'File',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'font-medium text-highlighted truncate' }, row.original.fileName),
        h(
          'p',
          { class: 'text-xs text-muted truncate' },
          [
            MODE_LABELS[row.original.mode],
            row.original.listName ? ` · ${row.original.listName}` : ''
          ].join('')
        )
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'totalRows',
    header: 'Rows',
    meta: {
      class: {
        th: 'w-24 text-right hidden sm:table-cell',
        td: 'w-24 text-right tabular-nums hidden sm:table-cell'
      }
    },
    cell: ({ row }) => number(row.original.totalRows)
  },
  {
    id: 'result',
    header: 'Created · updated · errors',
    meta: {
      class: {
        th: 'w-56 text-right hidden md:table-cell',
        td: 'w-56 text-right tabular-nums text-muted hidden md:table-cell'
      }
    },
    cell: ({ row }) =>
      h('span', {}, [
        h('span', { class: 'text-highlighted' }, number(row.original.createdCount)),
        ' · ',
        number(row.original.updatedCount),
        ' · ',
        h(
          'span',
          { class: row.original.errorCount ? 'text-error' : '' },
          number(row.original.errorCount)
        )
      ])
  },
  {
    accessorKey: 'createdAt',
    header: 'Started',
    meta: { class: { th: 'w-32', td: 'w-32 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: { original: ImportSummary }) {
  emit('select', row.original.id)
}
</script>

<template>
  <UTable
    v-if="loading || imports.length"
    :data="imports"
    :columns="columns"
    :loading="loading"
    :ui="tableUi"
    :meta="{ class: { tr: (row) => (row.original.id === activeId ? 'bg-elevated/50' : '') } }"
    class="shrink-0"
    @select="onSelect"
  />
  <EmptyState
    v-else
    icon="i-lucide-history"
    title="No imports yet"
    description="Your recent imports and their results show up here."
    appearance="outline"
    compact
  />
</template>
