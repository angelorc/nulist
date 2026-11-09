<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { AdminLimitsModal, AdminOrganizationCreateModal } from '#components'
import type { AdminOrganizationRow } from '#shared/schemas/organization'

/**
 * Instance administration: every organization with its members and usage
 * against its limits. Guarded by the `/admin/**` route rule (instance role
 * admin); works without an active organization.
 */
useSeoMeta({ title: 'Organizations' })

const route = useRoute()
const router = useRouter()
const { user } = useUserSession()
const organization = useOrganization()

const {
  data: organizations,
  status,
  error,
  refresh
} = await useFetch<AdminOrganizationRow[]>('/api/admin/organizations', { default: () => [] })

const loading = computed(() => status.value === 'pending')

const { number, date } = useFormat()
const overlay = useOverlay()
const createModal = overlay.create(AdminOrganizationCreateModal)
const limitsModal = overlay.create(AdminLimitsModal)

async function openCreate() {
  const created = await createModal.open({ defaultOwnerEmail: user.value?.email }).result

  if (!created) return
  await Promise.all([refresh(), organization.refresh()])
}

async function openLimits(row: AdminOrganizationRow) {
  const saved = await limitsModal.open({ organizationId: row.id, organizationName: row.name })
    .result

  if (saved) await refresh()
}

const { run: switchTo } = useApiAction((id: string) => organization.switchTo(id), {
  error: 'Could not switch organization'
})

// Deep link: /admin/organizations?new=1 opens the create modal.
onMounted(() => {
  if (route.query.new !== '1') return
  void router.replace({ query: {} })
  void openCreate()
})

defineShortcuts({ n: () => void openCreate() })

function rowActions(row: AdminOrganizationRow): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = [
    [{ label: 'Edit limits', icon: 'i-lucide-gauge', onSelect: () => openLimits(row) }]
  ]

  if (row.isMember && row.id !== organization.organization.value?.id) {
    groups.push([
      {
        label: 'Switch to organization',
        icon: 'i-lucide-arrow-left-right',
        onSelect: () => switchTo(row.id)
      }
    ])
  }

  return groups
}

const UBadge = resolveComponent('UBadge')
const AppOrganizationAvatar = resolveComponent('AppOrganizationAvatar')
const SettingsUsageMeter = resolveComponent('SettingsUsageMeter')

const columns: TableColumn<AdminOrganizationRow>[] = [
  {
    accessorKey: 'name',
    header: 'Organization',
    cell: ({ row }) =>
      h('div', { class: 'flex items-center gap-3 min-w-0' }, [
        h(AppOrganizationAvatar, { name: row.original.name, logo: row.original.logo, size: 'sm' }),
        h('div', { class: 'min-w-0' }, [
          h('p', { class: 'flex items-center gap-1.5 font-medium text-highlighted' }, [
            h('span', { class: 'truncate' }, row.original.name),
            row.original.id === organization.organization.value?.id
              ? h(UBadge, { label: 'Current', variant: 'outline' })
              : null
          ]),
          h('p', { class: 'font-mono text-xs text-muted truncate' }, row.original.slug)
        ])
      ])
  },
  {
    accessorKey: 'members',
    header: 'Members',
    meta: { class: { th: 'w-24 text-right', td: 'w-24 text-right tabular-nums text-muted' } },
    cell: ({ row }) => number(row.original.members)
  },
  {
    id: 'usage',
    header: 'Usage',
    meta: { class: { th: 'w-72 hidden md:table-cell', td: 'w-72 hidden md:table-cell' } },
    cell: ({ row }) =>
      h(
        'div',
        { class: 'space-y-2 py-1' },
        row.original.usage.map((item) =>
          h(SettingsUsageMeter, {
            key: item.key,
            label: item.label,
            used: item.used,
            limit: item.limit,
            unit: item.unit
          })
        )
      )
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    meta: {
      class: {
        th: 'w-32 hidden lg:table-cell',
        td: 'w-32 hidden lg:table-cell text-muted tabular-nums'
      }
    },
    cell: ({ row }) => date(row.original.createdAt)
  },
  rowActionsColumn({ items: rowActions, label: (row) => `Actions for ${row.name}` })
]
</script>

<template>
  <UDashboardPanel id="admin-organizations">
    <template #header>
      <UDashboardNavbar title="Organizations">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template v-if="organizations.length" #trailing>
          <UBadge :label="number(organizations.length)" variant="subtle" />
        </template>
        <template #right>
          <UTooltip text="Create organization" :kbds="['n']">
            <UButton
              label="Create organization"
              icon="i-lucide-plus"
              aria-label="Create organization"
              :ui="{ label: 'hidden sm:inline' }"
              @click="openCreate"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-sm text-muted shrink-0">
        Every organization on this instance. You see an organization's data only as one of its
        members.
      </p>

      <EmptyState
        v-if="error"
        variant="error"
        appearance="outline"
        title="Organizations could not be loaded"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          :loading="loading"
          @click="() => refresh()"
        />
      </EmptyState>

      <template v-else-if="loading || organizations.length">
        <UTable
          :data="organizations"
          :columns="columns"
          :loading="loading"
          sticky
          :ui="tableUi"
          class="shrink-0"
        />
        <TableFooter
          :total="organizations.length"
          :page-size="organizations.length"
          noun="organization"
        />
      </template>

      <EmptyState
        v-else
        appearance="outline"
        icon="i-lucide-building"
        title="No organizations yet"
        description="Create the first organization and choose its owner."
      >
        <UButton label="Create organization" icon="i-lucide-plus" @click="openCreate" />
      </EmptyState>
    </template>
  </UDashboardPanel>
</template>
