<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { TransactionalRecentEmail } from '#shared/schemas/transactional'

defineProps<{ items: TransactionalRecentEmail[]; loading?: boolean }>()

const logUrl = (id: string) => `/logs?tab=emails&id=${id}`

const { can } = useOrganization()

// Emails open in the logs for members who may read them.
const canReadLogs = computed(() => can({ log: ['read'] }))
const canCreateApiKey = computed(() => can({ apiKey: ['create'] }))

const ULink = resolveComponent('ULink')
const UTooltip = resolveComponent('UTooltip')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<TransactionalRecentEmail>[] = [
  {
    accessorKey: 'to',
    header: 'Recipient',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        canReadLogs.value
          ? h(
              ULink,
              {
                to: logUrl(row.original.id),
                class:
                  'block truncate font-medium text-highlighted hover:text-highlighted hover:underline underline-offset-2'
              },
              () => row.original.to
            )
          : h('p', { class: 'font-medium text-highlighted truncate' }, row.original.to),
        h(
          'p',
          { class: 'text-xs text-muted truncate', title: row.original.subject },
          row.original.subject
        )
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-28', td: 'w-28' } },
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
    id: 'template',
    header: 'Template',
    meta: {
      class: {
        th: 'w-36 hidden lg:table-cell',
        td: 'w-36 hidden lg:table-cell text-muted truncate'
      }
    },
    cell: ({ row }) => row.original.template?.name ?? 'Raw HTML'
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    meta: {
      class: { th: 'w-24 hidden sm:table-cell', td: 'w-24 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<TransactionalRecentEmail>) {
  void navigateTo(logUrl(row.original.id))
}
</script>

<template>
  <DashboardSection title="Recent emails" description="The last 10 transactional emails" flush>
    <template v-if="canReadLogs" #actions>
      <UButton
        label="All emails"
        variant="ghost"
        size="sm"
        trailing-icon="i-lucide-arrow-right"
        to="/logs?tab=emails&kind=transactional"
      />
    </template>

    <div class="px-4 pb-4">
      <UTable
        v-if="loading || items.length"
        :data="items"
        :columns="columns"
        :loading="loading"
        :ui="tableUi"
        :on-select="canReadLogs ? onSelect : undefined"
      >
        <template #loading>
          <div class="space-y-3 py-2" aria-busy="true">
            <USkeleton v-for="i in 5" :key="i" class="h-4 w-full" />
          </div>
        </template>
      </UTable>
      <EmptyState
        v-else
        compact
        icon="i-lucide-mail"
        title="No transactional emails yet"
        description="Send your first email with an API key and the quickstart below. It shows up here within seconds."
      >
        <UButton
          v-if="canCreateApiKey"
          label="Create an API key"
          icon="i-lucide-key-round"
          variant="outline"
          to="/settings/api-keys"
        />
      </EmptyState>
    </div>
  </DashboardSection>
</template>
