<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { ListsListFormModal } from '#components'

definePageMeta({ permission: { list: ['read'] } })

useSeoMeta({ title: 'Lists' })

const { can } = useOrganization()
const canCreate = computed(() => can({ list: ['create'] }))
const canUpdate = computed(() => can({ list: ['update'] }))
const canDelete = computed(() => can({ list: ['delete'] }))

const { data: lists, status, error, refresh } = await useFetch('/api/lists', { default: () => [] })

type ListRow = NonNullable<typeof lists.value>[number]

const { number } = useFormat()
const confirm = useConfirm()
const overlay = useOverlay()
const formModal = overlay.create(ListsListFormModal)

async function openForm(list?: ListRow) {
  if (!(list ? canUpdate.value : canCreate.value)) return

  const saved = await formModal.open({ list }).result

  if (saved) await refresh()
}

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/lists/${id}`, { method: 'DELETE' }),
  { success: 'List deleted', error: "Couldn't delete the list" }
)

async function onDelete(list: ListRow) {
  const ok = await confirm({
    title: `Delete "${list.name}"?`,
    description:
      "Contacts stay in your audience; only their membership in this list is removed. This can't be undone.",
    confirmLabel: 'Delete list',
    danger: true
  })

  if (ok && (await remove(list.id)) !== undefined) await refresh()
}

const ULink = resolveComponent('ULink')
const UBadge = resolveComponent('UBadge')
const TimeAgo = resolveComponent('TimeAgo')

/** Row menu: only the actions the member's role allows. */
function rowActions(list: ListRow): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = []

  if (canUpdate.value)
    groups.push([{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(list) }])

  if (canDelete.value)
    groups.push([
      { label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => onDelete(list) }
    ])

  return groups
}

const dataColumns: TableColumn<ListRow>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/lists/${row.original.id}`,
            class: 'block font-medium text-highlighted truncate hover:underline underline-offset-2'
          },
          () => row.original.name
        ),
        row.original.description
          ? h('p', { class: 'text-muted truncate' }, row.original.description)
          : null
      ])
  },
  {
    accessorKey: 'optIn',
    header: 'Opt-in',
    meta: { class: { th: 'w-28 hidden sm:table-cell', td: 'w-28 hidden sm:table-cell' } },
    cell: ({ row }) =>
      h(UBadge, {
        variant: 'outline',
        label: row.original.optIn === 'double' ? 'Double' : 'Single'
      })
  },
  {
    accessorKey: 'confirmedCount',
    header: 'Subscribed',
    meta: {
      class: { th: 'w-28 text-right', td: 'w-28 text-right tabular-nums text-highlighted' }
    },
    cell: ({ row }) => number(row.original.confirmedCount)
  },
  {
    accessorKey: 'unconfirmedCount',
    header: 'Unconfirmed',
    meta: {
      class: {
        th: 'w-28 text-right hidden md:table-cell',
        td: 'w-28 text-right tabular-nums hidden md:table-cell'
      }
    },
    cell: ({ row }) => number(row.original.unconfirmedCount)
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    meta: {
      class: { th: 'w-32 hidden lg:table-cell', td: 'w-32 text-muted hidden lg:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

const actionsColumn = rowActionsColumn<ListRow>({
  items: rowActions,
  label: (list) => `Actions for ${list.name}`
})

/** The `…` menu only appears when the member can edit or delete lists. */
const columns = computed(() =>
  canUpdate.value || canDelete.value ? [...dataColumns, actionsColumn] : dataColumns
)

function onSelect(_event: Event, row: { original: ListRow }) {
  void navigateTo(`/lists/${row.original.id}`)
}

defineShortcuts(computed(() => ({ n: canCreate.value ? () => openForm() : false })))
</script>

<template>
  <UDashboardPanel id="lists">
    <template #header>
      <UDashboardNavbar title="Lists">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #title>
          Lists
          <span class="hidden md:inline truncate text-sm font-normal text-muted">
            Contacts subscribe and unsubscribe per list
          </span>
        </template>
        <template #right>
          <Can v-slot="{ allowed }" :permission="{ list: ['create'] }" explain>
            <UTooltip text="New list" :kbds="['n']" :disabled="!allowed">
              <UButton
                label="New list"
                icon="i-lucide-plus"
                :disabled="!allowed"
                @click="openForm()"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Couldn't load lists"
        :description="apiErrorMessage(error)"
        appearance="outline"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          :loading="status === 'pending'"
          @click="() => refresh()"
        />
      </EmptyState>
      <UTable
        v-else-if="status === 'pending' || lists.length"
        :data="lists"
        :columns="columns"
        :loading="status === 'pending'"
        sticky
        :ui="tableUi"
        caption="Lists"
        class="shrink-0"
        @select="onSelect"
      />
      <EmptyState
        v-else
        icon="i-lucide-list"
        title="No lists yet"
        :description="
          canCreate
            ? 'Create a list to collect subscribers, then send broadcasts to it. Use segments for rule-based audiences.'
            : 'Lists created by your team show up here.'
        "
        appearance="outline"
      >
        <UButton v-if="canCreate" label="New list" icon="i-lucide-plus" @click="openForm()" />
      </EmptyState>

      <TableFooter v-if="!error" :total="lists.length" :page-size="lists.length" noun="list" />
    </template>
  </UDashboardPanel>
</template>
