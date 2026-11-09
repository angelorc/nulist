<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { ListsListFormModal } from '#components'

// Members are contacts (emails, names), so the page also needs contact:read.
definePageMeta({ permission: { list: ['read'], contact: ['read'] } })

const route = useRoute()
const id = String(route.params.id)
const { data: list, refresh: refreshList, error } = await useFetch(`/api/lists/${id}`)

// Another organization's list is "not found"; a missing permission stays a 403.
if (error.value?.statusCode === 403) {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: "You don't have permission to view this list.",
    fatal: true
  })
}

if (error.value || !list.value) {
  throw createError({
    // A malformed id (422 from the route's uuid check) is as unknown as a missing one.
    statusCode: !error.value || [404, 422].includes(error.value.statusCode ?? 0) ? 404 : 500,
    statusMessage: 'List not found',
    fatal: true
  })
}

useSeoMeta({ title: () => list.value?.name ?? 'List' })

const { can } = useOrganization()
const canUpdate = computed(() => can({ list: ['update'] }))
const canDelete = computed(() => can({ list: ['delete'] }))
const canImport = computed(() => can({ contact: ['import'] }))

interface Member {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: string
  contactStatus: string
  subscribedAt: string
}

type MemberFilters = { status: string | undefined }

const {
  page,
  pageSize,
  q,
  filters,
  items,
  total,
  loading,
  error: membersError,
  refresh: refreshMembers,
  isFiltered,
  clearFilters
} = usePaginatedList<Member, MemberFilters>(`/api/lists/${id}/members`, {
  filters: { status: undefined }
})

const statusItems = [
  { label: 'All statuses', value: 'all' },
  { label: 'Subscribed', value: 'confirmed' },
  { label: 'Unconfirmed', value: 'unconfirmed' },
  { label: 'Unsubscribed', value: 'unsubscribed' }
]

const overlay = useOverlay()
const formModal = overlay.create(ListsListFormModal)
const confirm = useConfirm()

const importUrl = `/contacts/import?listId=${id}`

async function edit() {
  if (!canUpdate.value || !list.value) return

  if (await formModal.open({ list: list.value }).result) await refreshList()
}

const { run: remove } = useApiAction(
  () => $fetch<unknown>(`/api/lists/${id}`, { method: 'DELETE' }),
  { success: 'List deleted', error: "Couldn't delete the list" }
)

async function onDelete() {
  if (!canDelete.value) return

  if (
    await confirm({
      title: `Delete "${list.value?.name}"?`,
      description:
        "Contacts stay in your audience; only their membership in this list is removed. This can't be undone.",
      confirmLabel: 'Delete list',
      danger: true
    })
  ) {
    if ((await remove()) !== undefined) await navigateTo('/lists')
  }
}

/** Secondary actions of the navbar `…` menu; Delete sits last in its own group. */
const menuItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []

  if (canUpdate.value)
    groups.push([{ label: 'Edit list', icon: 'i-lucide-pencil', onSelect: edit }])

  if (canDelete.value)
    groups.push([
      { label: 'Delete list', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }
    ])

  return groups
})

const ULink = resolveComponent('ULink')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

function fullName(member: Member): string {
  return [member.firstName, member.lastName].filter(Boolean).join(' ')
}

const columns: TableColumn<Member>[] = [
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
    header: 'Subscription',
    meta: { class: { th: 'w-28 sm:w-36', td: 'w-28 sm:w-36' } },
    cell: ({ row }) =>
      h(StatusBadge, {
        status: row.original.status,
        label: row.original.status === 'confirmed' ? 'Subscribed' : undefined
      })
  },
  {
    accessorKey: 'contactStatus',
    header: 'Contact',
    meta: { class: { th: 'w-32 hidden md:table-cell', td: 'w-32 hidden md:table-cell' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.contactStatus })
  },
  {
    accessorKey: 'subscribedAt',
    header: 'Added',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 text-muted hidden sm:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.subscribedAt })
  }
]

function onSelect(_event: Event, row: { original: Member }) {
  void navigateTo(`/contacts/${row.original.id}`)
}

const stats = computed(() => [
  { label: 'Subscribed', value: list.value?.confirmedCount ?? 0 },
  { label: 'Unconfirmed', value: list.value?.unconfirmedCount ?? 0 },
  { label: 'Unsubscribed', value: list.value?.unsubscribedCount ?? 0 }
])

const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts({ '/': () => searchInput.value?.inputRef?.focus() })
</script>

<template>
  <UDashboardPanel id="list-detail">
    <template #header>
      <UDashboardNavbar :title="list?.name">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/lists"
            aria-label="Back to lists"
          />
        </template>
        <template #trailing>
          <UBadge
            variant="outline"
            :label="list?.optIn === 'double' ? 'Double opt-in' : 'Single opt-in'"
            class="hidden sm:inline-flex"
          />
        </template>
        <template #right>
          <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More actions" />
          </UDropdownMenu>
          <Can v-slot="{ allowed }" :permission="{ contact: ['import'] }" explain>
            <UButton
              icon="i-lucide-upload"
              :to="allowed ? importUrl : undefined"
              :disabled="!allowed"
              aria-label="Import contacts"
            >
              <span class="hidden sm:inline">Import contacts</span>
            </UButton>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'w-full sm:w-auto' }">
        <template #left>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search email…"
            aria-label="Search members"
            class="flex-1 min-w-0 sm:flex-none sm:w-64"
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
            aria-label="Filter by subscription status"
            class="w-32 shrink-0 sm:w-44"
          />
        </template>
        <template #right>
          <UButton
            v-if="isFiltered"
            label="Clear filters"
            variant="ghost"
            size="sm"
            @click="clearFilters"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <p v-if="list?.description" class="text-sm text-muted">
        {{ list.description }}
      </p>

      <div
        class="grid grid-cols-3 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden shrink-0"
      >
        <KpiCard
          v-for="stat in stats"
          :key="stat.label"
          :label="stat.label"
          :value="stat.value"
          class="bg-default"
        />
      </div>

      <section aria-label="Members" class="flex flex-col gap-4">
        <EmptyState
          v-if="membersError && !items.length"
          variant="error"
          title="Couldn't load members"
          :description="apiErrorMessage(membersError)"
          appearance="outline"
        >
          <UButton
            label="Retry"
            icon="i-lucide-rotate-cw"
            variant="outline"
            :loading="loading"
            @click="() => refreshMembers()"
          />
        </EmptyState>
        <UTable
          v-else-if="loading || items.length"
          :data="items"
          :columns="columns"
          :loading="loading"
          sticky
          :ui="tableUi"
          caption="List members"
          class="shrink-0"
          @select="onSelect"
        />
        <EmptyState
          v-else-if="isFiltered"
          variant="no-results"
          title="No members match your filters"
          description="Try a different search or clear the filters."
          appearance="outline"
        >
          <UButton label="Clear filters" variant="outline" @click="clearFilters" />
        </EmptyState>
        <EmptyState
          v-else
          icon="i-lucide-users"
          title="This list has no members yet"
          :description="
            canImport
              ? 'Import a CSV or add contacts to this list from the Contacts page.'
              : 'Contacts added to this list show up here.'
          "
          appearance="outline"
        >
          <UButton
            v-if="canImport"
            label="Import contacts"
            icon="i-lucide-upload"
            :to="importUrl"
          />
        </EmptyState>

        <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="member" />
      </section>

      <PublicSignupFormSection v-if="list" :list="list" class="shrink-0" @edit="edit" />
    </template>
  </UDashboardPanel>
</template>
