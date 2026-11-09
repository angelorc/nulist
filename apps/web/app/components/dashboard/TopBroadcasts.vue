<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { TopBroadcast } from '#shared/types/analytics'

defineProps<{ items: TopBroadcast[]; loading?: boolean }>()

const { number, percent, date } = useFormat()
const { can } = useOrganization()

const ULink = resolveComponent('ULink')

/** Fixed layout needs a definite width, or long names widen the table past the card. */
const CARD_TABLE_UI = tableUi

/** Broadcast pages are linked only for members who can open them. */
const canOpen = computed(() => can({ broadcast: ['read'] }))

const columns = computed<TableColumn<TopBroadcast>[]>(() => [
  {
    accessorKey: 'name',
    header: 'Broadcast',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        canOpen.value
          ? h(
              ULink,
              {
                to: `/broadcasts/${row.original.id}`,
                class:
                  'block truncate font-medium text-highlighted hover:text-highlighted hover:underline underline-offset-2'
              },
              () => row.original.name
            )
          : h('p', { class: 'font-medium text-highlighted truncate' }, row.original.name),
        h(
          'p',
          { class: 'text-xs text-muted' },
          row.original.sentAt ? `Sent ${date(row.original.sentAt)}` : 'Sending'
        )
      ])
  },
  {
    accessorKey: 'recipients',
    header: 'Recipients',
    meta: {
      class: {
        th: 'w-28 text-right hidden sm:table-cell',
        td: 'w-28 text-right tabular-nums text-muted hidden sm:table-cell'
      }
    },
    cell: ({ row }) => number(row.original.recipients)
  },
  {
    accessorKey: 'openRate',
    header: 'Opens',
    meta: { class: { th: 'w-16 sm:w-20 text-right', td: 'text-right tabular-nums text-muted' } },
    cell: ({ row }) => percent(row.original.openRate)
  },
  {
    accessorKey: 'clickRate',
    header: 'Clicks',
    meta: {
      class: {
        th: 'w-16 sm:w-20 text-right',
        td: 'text-right tabular-nums text-highlighted font-medium'
      }
    },
    cell: ({ row }) => percent(row.original.clickRate)
  }
])

function onSelect(_event: Event, row: TableRow<TopBroadcast>) {
  void navigateTo(`/broadcasts/${row.original.id}`)
}
</script>

<template>
  <DashboardSection title="Top broadcasts" description="Ranked by click rate in this period">
    <template v-if="canOpen" #actions>
      <UButton
        label="All broadcasts"
        variant="ghost"
        size="sm"
        trailing-icon="i-lucide-arrow-right"
        to="/broadcasts"
      />
    </template>

    <UTable
      v-if="loading || items.length"
      :data="items"
      :columns="columns"
      :loading="loading"
      :ui="CARD_TABLE_UI"
      :on-select="canOpen ? onSelect : undefined"
    />
    <EmptyState
      v-else
      icon="i-lucide-send"
      title="No broadcasts sent in this period"
      description="Send a broadcast to see how it performs against the others."
      compact
    >
      <UButton v-if="canOpen" label="Go to broadcasts" variant="outline" to="/broadcasts" />
    </EmptyState>
  </DashboardSection>
</template>
