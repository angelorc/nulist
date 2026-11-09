<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import { inboundEventLabel } from '#shared/schemas/webhooks'
import type { InboundEventListItem as InboundEventItem } from '#shared/schemas/webhooks'

defineProps<{ items: InboundEventItem[]; loading?: boolean }>()

const emit = defineEmits<{ select: [item: InboundEventItem] }>()

const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')
const UIcon = resolveComponent('UIcon')
const UTooltip = resolveComponent('UTooltip')

const columns: TableColumn<InboundEventItem>[] = [
  {
    accessorKey: 'eventType',
    header: 'Event',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'flex items-center gap-1.5 font-medium text-highlighted truncate' }, [
          inboundEventLabel(row.original),
          row.original.type === 'Simulation'
            ? [
                h(UTooltip, { text: 'Simulated from the dashboard' }, () =>
                  h(UIcon, {
                    name: 'i-lucide-flask-conical',
                    class: 'size-3.5 text-muted shrink-0'
                  })
                ),
                h('span', { class: 'sr-only' }, '(simulated)')
              ]
            : null
        ]),
        row.original.recipient
          ? h('p', { class: 'text-muted truncate' }, row.original.recipient)
          : null
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-32', td: 'w-32' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'error',
    header: 'Detail',
    meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell text-muted' } },
    cell: ({ row }) =>
      row.original.error
        ? h('p', { class: 'truncate', title: row.original.error }, row.original.error)
        : emptyCell()
  },
  {
    accessorKey: 'createdAt',
    header: 'Received',
    meta: { class: { th: 'w-32', td: 'w-32 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<InboundEventItem>) {
  emit('select', row.original)
}
</script>

<template>
  <UTable
    :data="items"
    :columns="columns"
    :loading="loading"
    :ui="tableUi"
    class="shrink-0"
    @select="onSelect"
  />
</template>
