<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permission: { segment: ['read'] } })

useSeoMeta({ title: 'Segments' })

const {
  data: segments,
  status,
  error,
  refresh
} = await useFetch('/api/segments', { default: () => [] })

type SegmentRow = NonNullable<typeof segments.value>[number]

const { can } = useOrganization()
const canCreate = computed(() => can({ segment: ['create'] }))
const canUpdate = computed(() => can({ segment: ['update'] }))
const canDelete = computed(() => can({ segment: ['delete'] }))
const canViewContacts = computed(() => can({ contact: ['read'] }))

const { number } = useFormat()
const confirm = useConfirm()

const search = ref('')

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  if (!term) return segments.value

  return segments.value.filter(
    (s) =>
      s.name.toLowerCase().includes(term) ||
      s.summary.toLowerCase().includes(term) ||
      (s.description ?? '').toLowerCase().includes(term)
  )
})

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/segments/${id}`, { method: 'DELETE' }),
  { success: 'Segment deleted' }
)

const { run: duplicate } = useApiAction(
  (segment: SegmentRow) =>
    $fetch<{ id: string }>('/api/segments', {
      method: 'POST',
      body: {
        name: `${segment.name} (copy)`.slice(0, 120),
        description: segment.description,
        rules: segment.rules
      }
    }),
  { success: 'Segment duplicated' }
)

async function onDelete(segment: SegmentRow) {
  const ok = await confirm({
    title: `Delete "${segment.name}"?`,
    description:
      "Contacts are not affected; only this saved filter is removed. Broadcasts already sent keep their recipients. This can't be undone.",
    confirmLabel: 'Delete segment',
    danger: true
  })

  if (ok && (await remove(segment.id)) !== undefined) await refresh()
}

async function onDuplicate(segment: SegmentRow) {
  const created = await duplicate(segment)

  if (created) await navigateTo(`/segments/${created.id}`)
}

/** Row actions the member may run; groups without an allowed action are dropped. */
function rowActions(segment: SegmentRow): DropdownMenuItem[][] {
  // Read-only members open the segment to see its conditions.
  const open: DropdownMenuItem[] = [
    {
      label: canUpdate.value ? 'Edit' : 'Open',
      icon: canUpdate.value ? 'i-lucide-pencil' : 'i-lucide-eye',
      onSelect: () => navigateTo(`/segments/${segment.id}`)
    }
  ]

  if (canViewContacts.value) {
    open.push({
      label: 'View contacts',
      icon: 'i-lucide-users',
      onSelect: () => navigateTo(`/segments/${segment.id}?tab=contacts`)
    })
  }

  if (canCreate.value) {
    open.push({ label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => onDuplicate(segment) })
  }

  const danger: DropdownMenuItem[] = canDelete.value
    ? [
        {
          label: 'Delete',
          icon: 'i-lucide-trash',
          color: 'error',
          onSelect: () => onDelete(segment)
        }
      ]
    : []

  return [open, danger].filter((group) => group.length)
}

const ULink = resolveComponent('ULink')
const TimeAgo = resolveComponent('TimeAgo')

const columns: TableColumn<SegmentRow>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/segments/${row.original.id}`,
            class: 'block font-medium text-highlighted truncate hover:underline underline-offset-2'
          },
          () => row.original.name
        ),
        h('p', { class: 'text-muted truncate', title: row.original.summary }, row.original.summary)
      ])
  },
  {
    accessorKey: 'contactCount',
    header: 'Contacts',
    meta: {
      class: { th: 'w-28 text-right', td: 'w-28 text-right tabular-nums text-highlighted' }
    },
    cell: ({ row }) =>
      row.original.contactCount === null
        ? h('span', {}, [
            emptyCell(),
            h('span', { class: 'sr-only' }, 'The rules could not be evaluated')
          ])
        : number(row.original.contactCount)
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 text-muted hidden sm:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.updatedAt })
  },
  rowActionsColumn<SegmentRow>({
    items: rowActions,
    label: (segment) => `Actions for ${segment.name}`
  })
]

function onSelect(_event: Event, row: { original: SegmentRow }) {
  void navigateTo(`/segments/${row.original.id}`)
}

const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts(
  computed(() => ({
    n: canCreate.value ? () => navigateTo('/segments/new') : false,
    '/': () => searchInput.value?.inputRef?.focus()
  }))
)
</script>

<template>
  <UDashboardPanel id="segments">
    <template #header>
      <UDashboardNavbar title="Segments">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #title>
          Segments
          <span class="hidden md:inline truncate text-sm font-normal text-muted">
            Rule-based audiences that update as contacts change
          </span>
        </template>
        <template #right>
          <Can v-slot="{ allowed }" :permission="{ segment: ['create'] }" explain>
            <UTooltip text="New segment" :kbds="['n']" :disabled="!allowed">
              <UButton
                label="New segment"
                icon="i-lucide-plus"
                :to="allowed ? '/segments/new' : undefined"
                :disabled="!allowed"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar v-if="segments.length">
        <template #left>
          <UInput
            ref="search"
            v-model="search"
            icon="i-lucide-search"
            placeholder="Search segments…"
            aria-label="Search segments"
            class="w-full sm:w-64"
          >
            <template #trailing>
              <UKbd v-if="!search" value="/" />
              <UButton
                v-else
                icon="i-lucide-x"
                variant="link"
                size="xs"
                aria-label="Clear search"
                @click="search = ''"
              />
            </template>
          </UInput>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Couldn't load segments"
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
        v-else-if="status === 'pending' || filtered.length"
        :data="filtered"
        :columns="columns"
        :loading="status === 'pending'"
        sticky
        :ui="tableUi"
        caption="Segments"
        class="shrink-0"
        @select="onSelect"
      />
      <EmptyState
        v-else-if="search"
        variant="no-results"
        :title="`No segments match “${search}”`"
        description="Try a different name or clear the search."
        appearance="outline"
      >
        <UButton label="Clear search" variant="outline" @click="search = ''" />
      </EmptyState>
      <EmptyState
        v-else
        icon="i-lucide-filter"
        title="No segments yet"
        description="Group contacts by properties, list membership or engagement, then send broadcasts to them."
        appearance="outline"
      >
        <UButton v-if="canCreate" label="New segment" icon="i-lucide-plus" to="/segments/new" />
      </EmptyState>

      <TableFooter
        v-if="!error"
        :total="filtered.length"
        :page-size="filtered.length"
        noun="segment"
      />
    </template>
  </UDashboardPanel>
</template>
