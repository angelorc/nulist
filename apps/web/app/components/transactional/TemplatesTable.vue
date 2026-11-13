<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { TransactionalTemplateItem } from '#shared/schemas/transactional'

const props = defineProps<{ templates: TransactionalTemplateItem[]; loading?: boolean }>()

const NEW_TEMPLATE = '/templates?new=1&kind=transactional'

const { can } = useOrganization()
const canCreateTemplate = computed(() => can({ template: ['create'] }))
const canReadLogs = computed(() => can({ log: ['read'] }))

// Members who cannot edit templates open them read-only.
const rowAction = computed(() =>
  can({ template: ['update'] })
    ? { verb: 'Edit', icon: 'i-lucide-pencil' }
    : { verb: 'View', icon: 'i-lucide-eye' }
)

const q = ref('')

const filtered = computed(() => {
  const term = q.value.trim().toLowerCase()

  if (!term) return props.templates

  return props.templates.filter((t) =>
    [t.name, t.slug ?? '', t.subject].some((v) => v.toLowerCase().includes(term))
  )
})

const { number } = useFormat()

const ULink = resolveComponent('ULink')
const UButton = resolveComponent('UButton')
const UTooltip = resolveComponent('UTooltip')
const CopyText = resolveComponent('CopyText')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<TransactionalTemplateItem>[] = [
  {
    accessorKey: 'name',
    header: 'Template',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/templates/${row.original.id}`,
            class:
              'block truncate font-medium text-highlighted hover:text-highlighted hover:underline underline-offset-2'
          },
          () => row.original.name
        ),
        h(
          'p',
          { class: 'text-xs text-muted truncate', title: row.original.subject },
          row.original.subject || 'No subject'
        )
      ])
  },
  {
    accessorKey: 'slug',
    header: 'Slug',
    meta: { class: { th: 'w-44', td: 'w-44' } },
    cell: ({ row }) => (row.original.slug ? h(CopyText, { value: row.original.slug }) : emptyCell())
  },
  {
    accessorKey: 'sent7d',
    header: 'Sent (7d)',
    meta: {
      class: {
        th: 'w-24 hidden sm:table-cell text-right',
        td: 'w-24 hidden sm:table-cell text-right tabular-nums text-muted'
      }
    },
    cell: ({ row }) =>
      canReadLogs.value && row.original.sent7d
        ? h(
            ULink,
            {
              to: LogLinks.emails({
                kind: ['transactional'],
                templateId: row.original.id,
                period: '7d'
              }),
              class: 'text-muted hover:text-highlighted hover:underline underline-offset-2',
              'aria-label': `View ${row.original.name} emails sent in the last 7 days`
            },
            () => number(row.original.sent7d)
          )
        : number(row.original.sent7d)
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    meta: {
      class: { th: 'w-28 hidden md:table-cell', td: 'w-28 hidden md:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.updatedAt })
  },
  {
    id: 'actions',
    meta: { class: { th: 'w-12', td: 'w-12 text-right' } },
    cell: ({ row }) =>
      h(UTooltip, { text: `${rowAction.value.verb} template` }, () =>
        h(UButton, {
          icon: rowAction.value.icon,
          variant: 'ghost',
          size: 'sm',
          to: `/templates/${row.original.id}`,
          'aria-label': `${rowAction.value.verb} ${row.original.name}`
        })
      )
  }
]

function onSelect(_event: Event, row: TableRow<TransactionalTemplateItem>) {
  void navigateTo(`/templates/${row.original.id}`)
}
</script>

<template>
  <DashboardSection title="Templates" description="Send them by slug from your code" flush>
    <template v-if="templates.length" #actions>
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Filter templates"
        size="sm"
        class="w-44"
        aria-label="Filter templates"
      >
        <template v-if="q" #trailing>
          <UButton
            icon="i-lucide-x"
            size="xs"
            variant="link"
            aria-label="Clear filter"
            @click="q = ''"
          />
        </template>
      </UInput>
    </template>

    <div class="px-4 pb-4">
      <UTable
        v-if="loading || filtered.length"
        :data="filtered"
        :columns="columns"
        :loading="loading"
        :ui="tableUi"
        @select="onSelect"
      >
        <template #loading>
          <div class="space-y-3 py-2" aria-busy="true">
            <USkeleton v-for="i in 3" :key="i" class="h-4 w-full" />
          </div>
        </template>
      </UTable>
      <EmptyState
        v-else-if="templates.length"
        compact
        variant="no-results"
        title="No templates match"
        :description="`Nothing matches “${q}” in names, slugs or subjects.`"
      >
        <UButton label="Clear filter" variant="outline" @click="q = ''" />
      </EmptyState>
      <EmptyState
        v-else
        compact
        icon="i-lucide-layout-template"
        title="No transactional templates yet"
        description="Create one for each email your app sends, like a receipt or a password reset, and send it by its slug."
      >
        <UButton
          v-if="canCreateTemplate"
          label="New template"
          icon="i-lucide-plus"
          variant="outline"
          :to="NEW_TEMPLATE"
        />
      </EmptyState>
    </div>
  </DashboardSection>
</template>
