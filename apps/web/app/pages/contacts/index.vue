<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { Column, RowSelectionState, SortingState } from '@tanstack/table-core'
import { ContactsFormModal, ContactsListPickerModal } from '#components'
import { CONTACT_BULK_PERMISSIONS, CONTACT_SORTS } from '#shared/schemas/contacts'
import type { ContactBulkInput } from '#shared/schemas/contacts'
import type { BulkActionResult, ContactListItem } from '#shared/types/contacts'

definePageMeta({ permission: { contact: ['read'] } })

useSeoMeta({ title: 'Contacts' })

const route = useRoute()
const router = useRouter()
const { number } = useFormat()
const confirm = useConfirm()
const overlay = useOverlay()
const formModal = overlay.create(ContactsFormModal)
const listPicker = overlay.create(ContactsListPickerModal)

// Permissions --------------------------------------------------------------------
const { can } = useOrganization()
const canCreate = computed(() => can({ contact: ['create'] }))
const canImport = computed(() => can({ contact: ['import'] }))
const canExport = computed(() => can({ contact: ['export'] }))
const canUpdate = computed(() => can(CONTACT_BULK_PERMISSIONS.add_to_list))
const canDelete = computed(() => can(CONTACT_BULK_PERMISSIONS.delete))
const canReadLogs = computed(() => can({ log: ['read'] }))

/** Row selection is only useful with at least one bulk action. */
const canSelect = computed(() => canUpdate.value || canDelete.value || canExport.value)

type ContactListFilters = {
  status: string | undefined
  listId: string | undefined
  sort: string | undefined
}

const { page, pageSize, q, filters, items, total, loading, error, refresh } = usePaginatedList<
  ContactListItem,
  ContactListFilters
>('/api/contacts', {
  filters: { status: undefined, listId: undefined, sort: undefined }
})

const { data: lists } = useFetch('/api/lists', { default: () => [], key: 'contacts-list-filter' })

const hasFilters = computed(
  () => !!q.value || [filters.status, filters.listId].some((v) => v && v !== 'all')
)

function clearFilters() {
  q.value = ''
  filters.status = undefined
  filters.listId = undefined
}

const statusItems = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Unsubscribed', value: 'unsubscribed' },
  { label: 'Bounced', value: 'bounced' },
  { label: 'Complained', value: 'complained' },
  { label: 'Blocklisted', value: 'blocklisted' }
]

const listItems = computed(() => [
  { label: 'All lists', value: 'all' },
  ...lists.value.map((l) => ({ label: l.name, value: l.id }))
])

// Sorting (server-side) ---------------------------------------------------------
const sorting = computed<SortingState>({
  get: () => {
    const sort = filters.sort ?? '-createdAt'

    return [{ id: sort.replace(/^-/, ''), desc: sort.startsWith('-') }]
  },
  set: (value) => {
    const first = value[0]
    const wanted = first ? `${first.desc ? '-' : ''}${first.id}` : undefined
    const next = CONTACT_SORTS.find((sort) => sort === wanted)
    filters.sort = next === '-createdAt' ? undefined : next
  }
})

// Selection (kept across pages, cleared when filters change) --------------------
const rowSelection = ref<RowSelectionState>({})

const selectedIds = computed(() =>
  Object.keys(rowSelection.value).filter((id) => rowSelection.value[id])
)

watch(
  () => [q.value, filters.status, filters.listId],
  () => {
    rowSelection.value = {}
  }
)

// Actions -----------------------------------------------------------------------
async function openForm() {
  if (!canCreate.value) return

  const id = await formModal.open({
    listId: filters.listId && filters.listId !== 'all' ? filters.listId : undefined
  }).result

  if (id) await refresh()
}

watch(
  () => route.query.new,
  async (value) => {
    if (!value || import.meta.server) return
    await router.replace({ query: { ...route.query, new: undefined } })

    // ⌘K "Add contact" lands here: without permission the query is only cleared.
    if (canCreate.value) await openForm()
  },
  { immediate: true }
)

const { run: bulkRun, pending: bulkPending } = useApiAction(
  (body: ContactBulkInput) =>
    $fetch<BulkActionResult>('/api/contacts/bulk', { method: 'POST', body }),
  { error: "Couldn't update the contacts" }
)

const notify = useNotify()

async function runBulk(body: ContactBulkInput, message: (n: number) => string) {
  const result = await bulkRun(body)

  if (!result) return
  notify.success(message(result.affected))
  rowSelection.value = {}
  await refresh()
}

const plural = (n: number) => `${number(n)} contact${n === 1 ? '' : 's'}`

async function addToList(ids: string[]) {
  const pick = await listPicker.open({
    title: `Add ${plural(ids.length)} to a list`,
    confirmLabel: 'Add to list',
    mode: 'add'
  }).result

  if (!pick) return
  await runBulk(
    { action: 'add_to_list', ids, listId: pick.listId, skipOptIn: pick.skipOptIn },
    (n) =>
      n
        ? `Added ${plural(n)} to the list`
        : 'Nothing changed: contacts were already on the list or not active'
  )
}

async function removeFromList(ids: string[]) {
  const pick = await listPicker.open({
    title: `Remove ${plural(ids.length)} from a list`,
    description: 'They are marked as unsubscribed from that list only.',
    confirmLabel: 'Remove from list',
    mode: 'remove'
  }).result

  if (!pick) return
  await runBulk(
    { action: 'remove_from_list', ids, listId: pick.listId },
    (n) => `Removed ${plural(n)} from the list`
  )
}

async function unsubscribe(ids: string[]) {
  const ok = await confirm({
    title: `Unsubscribe ${plural(ids.length)}?`,
    description:
      'They leave every list and are added to the suppression list. Transactional emails still go through.',
    confirmLabel: 'Unsubscribe'
  })

  if (ok) await runBulk({ action: 'unsubscribe', ids }, (n) => `Unsubscribed ${plural(n)}`)
}

async function remove(ids: string[]) {
  const ok = await confirm({
    title: `Delete ${plural(ids.length)}?`,
    description:
      "Their profile, list memberships and attributes are removed. Sent email logs are kept. This can't be undone.",
    confirmLabel: `Delete ${plural(ids.length)}`,
    danger: true
  })

  if (ok) await runBulk({ action: 'delete', ids }, (n) => `Deleted ${plural(n)}`)
}

function exportUrl(ids?: string[]): string {
  const params = new URLSearchParams()

  if (ids?.length) params.set('ids', ids.join(','))
  else {
    if (q.value) params.set('q', q.value)

    if (filters.status && filters.status !== 'all') params.set('status', filters.status)

    if (filters.listId && filters.listId !== 'all') params.set('listId', filters.listId)
  }

  const query = params.toString()

  return `/api/contacts/export${query ? `?${query}` : ''}`
}

function download(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  link.click()
}

// Table -------------------------------------------------------------------------
const UButton = resolveComponent('UButton')
const UCheckbox = resolveComponent('UCheckbox')
const ULink = resolveComponent('ULink')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

function sortHeader(label: string, descFirst = false) {
  return ({ column }: { column: Column<ContactListItem> }) => {
    const sorted = column.getIsSorted()

    return h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      label,
      trailingIcon:
        sorted === 'asc'
          ? 'i-lucide-arrow-up'
          : sorted === 'desc'
            ? 'i-lucide-arrow-down'
            : 'i-lucide-arrow-up-down',
      class: ['-mx-2 text-[13px] font-medium', sorted ? 'text-highlighted' : 'text-muted'],
      'aria-label': `Sort by ${label.toLowerCase()}`,
      onClick: () => column.toggleSorting(sorted ? sorted === 'asc' : descFirst)
    })
  }
}

function fullName(c: ContactListItem) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ')
}

/** Row menu: only the actions the member's role allows. */
function rowActions(contact: ContactListItem): DropdownMenuItem[][] {
  const navigation: DropdownMenuItem[] = [
    { label: 'View contact', icon: 'i-lucide-user', to: `/contacts/${contact.id}` }
  ]

  if (canReadLogs.value)
    navigation.push({
      label: 'View emails',
      icon: 'i-lucide-scroll-text',
      to: LogLinks.emails({ contactId: contact.id })
    })

  const changes: DropdownMenuItem[] = []

  if (canUpdate.value) {
    navigation.push({
      label: 'Add to list…',
      icon: 'i-lucide-list-plus',
      onSelect: () => addToList([contact.id])
    })

    if (contact.status !== 'unsubscribed')
      changes.push({
        label: 'Unsubscribe',
        icon: 'i-lucide-mail-x',
        onSelect: () => unsubscribe([contact.id])
      })
  }

  if (canDelete.value)
    changes.push({
      label: 'Delete',
      icon: 'i-lucide-trash',
      color: 'error',
      onSelect: () => remove([contact.id])
    })

  return changes.length ? [navigation, changes] : [navigation]
}

const selectColumn: TableColumn<ContactListItem> = {
  id: 'select',
  meta: { class: { th: 'w-10', td: 'w-10' } },
  header: ({ table }) =>
    h(UCheckbox, {
      modelValue: table.getIsSomePageRowsSelected()
        ? 'indeterminate'
        : table.getIsAllPageRowsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') =>
        table.toggleAllPageRowsSelected(!!value),
      'aria-label': 'Select all on this page'
    }),
  cell: ({ row }) =>
    h(UCheckbox, {
      modelValue: row.getIsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
      'aria-label': `Select ${row.original.email}`
    })
}

const dataColumns: TableColumn<ContactListItem>[] = [
  {
    accessorKey: 'email',
    header: sortHeader('Contact'),
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
    header: sortHeader('Status'),
    meta: { class: { th: 'w-28 sm:w-36', td: 'w-28 sm:w-36' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'listCount',
    enableSorting: false,
    header: 'Lists',
    meta: {
      class: {
        th: 'w-20 text-right hidden md:table-cell',
        td: 'w-20 text-right tabular-nums text-muted hidden md:table-cell'
      }
    },
    cell: ({ row }) => number(row.original.listCount)
  },
  {
    accessorKey: 'lastOpenedAt',
    header: sortHeader('Last opened', true),
    meta: {
      class: { th: 'w-36 hidden lg:table-cell', td: 'w-36 text-muted hidden lg:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.lastOpenedAt, fallback: 'Never' })
  },
  {
    accessorKey: 'createdAt',
    header: sortHeader('Added', true),
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 text-muted hidden sm:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  },
  rowActionsColumn<ContactListItem>({
    items: rowActions,
    label: (contact) => `Actions for ${contact.email}`
  })
]

const columns = computed(() => (canSelect.value ? [selectColumn, ...dataColumns] : dataColumns))

function onSelect(_event: Event, row: { original: ContactListItem }) {
  void navigateTo(`/contacts/${row.original.id}`)
}

// Keyboard ----------------------------------------------------------------------
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts(
  computed(() => ({
    n: canCreate.value ? () => openForm() : false,
    '/': () => searchInput.value?.inputRef?.focus()
  }))
)

/** Bulk actions folded into the overflow menu on smaller screens. */
const moreBulkItems = computed<DropdownMenuItem[][]>(() => {
  const actions: DropdownMenuItem[] = []

  if (canUpdate.value)
    actions.push(
      {
        label: 'Remove from list',
        icon: 'i-lucide-list-minus',
        onSelect: () => removeFromList(selectedIds.value)
      },
      {
        label: 'Unsubscribe',
        icon: 'i-lucide-mail-x',
        onSelect: () => unsubscribe(selectedIds.value)
      }
    )

  if (canExport.value)
    actions.push({
      label: 'Export',
      icon: 'i-lucide-download',
      onSelect: () => download(exportUrl(selectedIds.value))
    })

  return actions.length ? [actions] : []
})

const firstRun = computed(
  () => !loading.value && !error.value && !items.value.length && !hasFilters.value
)
</script>

<template>
  <UDashboardPanel id="contacts">
    <template #header>
      <UDashboardNavbar title="Contacts">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <UBadge v-if="total" :label="number(total)" class="tabular-nums" />
        </template>
        <template #right>
          <Can :permission="{ contact: ['export'] }">
            <UTooltip text="Download the contacts matching the filters as CSV">
              <UButton
                label="Export"
                icon="i-lucide-download"
                variant="ghost"
                class="hidden sm:inline-flex"
                :disabled="!total"
                @click="download(exportUrl())"
              />
            </UTooltip>
          </Can>
          <Can :permission="{ contact: ['import'] }">
            <UButton
              icon="i-lucide-upload"
              variant="ghost"
              to="/contacts/import"
              aria-label="Import contacts"
            >
              <span class="hidden sm:inline">Import</span>
            </UButton>
          </Can>
          <Can v-slot="{ allowed }" :permission="{ contact: ['create'] }" explain>
            <UTooltip text="Add contact" :kbds="['n']" :disabled="!allowed">
              <UButton
                icon="i-lucide-plus"
                aria-label="Add contact"
                :disabled="!allowed"
                @click="openForm"
              >
                <span class="hidden sm:inline">Add contact</span>
              </UButton>
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        v-if="!firstRun"
        :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'flex-wrap w-full sm:w-auto' }"
      >
        <template #left>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search email or name…"
            class="w-full sm:w-64"
            aria-label="Search contacts"
          >
            <template #trailing>
              <UKbd v-if="!q" value="/" />
              <UButton
                v-else
                icon="i-lucide-x"
                variant="link"
                size="xs"
                aria-label="Clear search"
                @click="q = ''"
              />
            </template>
          </UInput>
          <USelect
            v-model="filters.status"
            :items="statusItems"
            placeholder="All statuses"
            class="flex-1 sm:flex-none sm:w-40"
            aria-label="Filter by status"
          />
          <USelectMenu
            v-model="filters.listId"
            :items="listItems"
            value-key="value"
            placeholder="All lists"
            icon="i-lucide-list"
            class="flex-1 min-w-0 sm:flex-none sm:w-48"
            aria-label="Filter by list"
          />
        </template>
        <template #right>
          <UButton
            v-if="hasFilters"
            label="Clear filters"
            variant="ghost"
            size="sm"
            @click="clearFilters"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !items.length"
        variant="error"
        title="Couldn't load contacts"
        :description="apiErrorMessage(error)"
        appearance="outline"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          :loading="loading"
          @click="() => refresh()"
        />
      </EmptyState>

      <UTable
        v-else-if="loading || items.length"
        v-model:sorting="sorting"
        v-model:row-selection="rowSelection"
        :data="items"
        :columns="columns"
        :loading="loading"
        :get-row-id="(row: ContactListItem) => row.id"
        :sorting-options="{ manualSorting: true, enableSortingRemoval: false }"
        sticky
        :ui="tableUi"
        caption="Contacts"
        class="shrink-0"
        @select="onSelect"
      />

      <EmptyState
        v-else-if="hasFilters"
        variant="no-results"
        title="No contacts match your filters"
        description="Try a different search or clear the filters."
        appearance="outline"
      >
        <UButton label="Clear filters" variant="outline" @click="clearFilters" />
      </EmptyState>

      <EmptyState
        v-else
        icon="i-lucide-users"
        title="No contacts yet"
        :description="
          canImport || canCreate
            ? 'Import a CSV from your previous tool or add your first contact by hand.'
            : 'Contacts added by your team show up here.'
        "
        appearance="outline"
      >
        <UButton v-if="canImport" label="Import CSV" icon="i-lucide-upload" to="/contacts/import" />
        <UButton
          v-if="canCreate"
          label="Add contact"
          icon="i-lucide-plus"
          variant="outline"
          @click="openForm"
        />
      </EmptyState>

      <TableFooter
        v-model:page="page"
        :total="total"
        :page-size="pageSize"
        :selected="selectedIds.length"
        noun="contact"
      />

      <BulkBar
        v-if="canSelect"
        :count="selectedIds.length"
        label="Actions for the selected contacts"
        @clear="rowSelection = {}"
      >
        <UButton
          v-if="canUpdate"
          icon="i-lucide-list-plus"
          variant="ghost"
          size="sm"
          aria-label="Add to list"
          :disabled="bulkPending"
          @click="addToList(selectedIds)"
        >
          <span class="hidden sm:inline">Add to list</span>
        </UButton>
        <UButton
          v-if="canUpdate"
          label="Remove from list"
          icon="i-lucide-list-minus"
          variant="ghost"
          size="sm"
          class="hidden xl:inline-flex"
          :disabled="bulkPending"
          @click="removeFromList(selectedIds)"
        />
        <UButton
          v-if="canUpdate"
          label="Unsubscribe"
          icon="i-lucide-mail-x"
          variant="ghost"
          size="sm"
          class="hidden xl:inline-flex"
          :disabled="bulkPending"
          @click="unsubscribe(selectedIds)"
        />
        <UButton
          v-if="canExport"
          label="Export"
          icon="i-lucide-download"
          variant="ghost"
          size="sm"
          class="hidden xl:inline-flex"
          @click="download(exportUrl(selectedIds))"
        />
        <UDropdownMenu
          v-if="moreBulkItems.length"
          :items="moreBulkItems"
          :content="{ side: 'top' }"
        >
          <UButton
            icon="i-lucide-ellipsis"
            variant="ghost"
            size="sm"
            aria-label="More bulk actions"
            :disabled="bulkPending"
            class="xl:hidden"
          />
        </UDropdownMenu>
        <UButton
          v-if="canDelete"
          icon="i-lucide-trash"
          color="error"
          variant="ghost"
          size="sm"
          aria-label="Delete selected"
          :loading="bulkPending"
          @click="remove(selectedIds)"
        >
          <span class="hidden sm:inline">Delete</span>
        </UButton>
      </BulkBar>
    </template>
  </UDashboardPanel>
</template>
