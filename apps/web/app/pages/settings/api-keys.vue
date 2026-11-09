<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { SettingsApiKeyCreateModal } from '#components'
import { API_KEY_SCOPE_OPTIONS } from '#shared/schemas/api-keys'
import type { ApiKeySummary } from '#shared/schemas/api-keys'

definePageMeta({ permission: { apiKey: ['read'] } })

useSeoMeta({ title: 'API keys' })

const NO_PERMISSION = "You don't have permission to create API keys"

const { organization, can } = useOrganization()
const canCreate = computed(() => can({ apiKey: ['create'] }))
const canRevoke = computed(() => can({ apiKey: ['delete'] }))

const {
  data: keys,
  status,
  error,
  refresh
} = await useFetch<ApiKeySummary[]>('/api/api-keys', {
  key: () => `api-keys:${organization.value?.id ?? 'none'}`,
  default: () => []
})

const { date } = useFormat()
const confirm = useConfirm()
const createModal = useOverlay().create(SettingsApiKeyCreateModal)

/** Prefix of the most recently created key, used in the quickstart so it matches what was just copied. */
const lastCreatedStart = ref<string | null>(null)

defineShortcuts(computed(() => ({ n: canCreate.value ? () => void openCreate() : false })))

async function openCreate() {
  if (!canCreate.value) return

  const created = await createModal.open().result

  if (!created) return
  lastCreatedStart.value = created.start
  await refresh()
}

const { run: revoke } = useApiAction(
  (id: string) => {
    const url: string = `/api/api-keys/${id}`

    return $fetch<unknown>(url, { method: 'DELETE' })
  },
  { success: 'API key revoked', error: 'Could not revoke the key' }
)

async function onRevoke(key: ApiKeySummary) {
  const ok = await confirm({
    title: `Revoke ${key.name || 'this key'}?`,
    description: "Requests using this key fail immediately. This can't be undone.",
    confirmLabel: 'Revoke key',
    danger: true
  })

  if (ok && (await revoke(key.id)) !== undefined) await refresh()
}

const scopeLabel = (scope: ApiKeySummary['scope']) =>
  API_KEY_SCOPE_OPTIONS.find((item) => item.value === scope)?.label ?? scope

const isExpired = (key: ApiKeySummary) =>
  !!key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()

/** Row menu: revoking, in its own destructive group. */
function rowActions(key: ApiKeySummary): DropdownMenuItem[][] {
  return canRevoke.value
    ? [
        [
          {
            label: 'Revoke key',
            icon: 'i-lucide-trash',
            color: 'error',
            onSelect: () => onRevoke(key)
          }
        ]
      ]
    : []
}

const UBadge = resolveComponent('UBadge')
const TimeAgo = resolveComponent('TimeAgo')

const columns = computed<TableColumn<ApiKeySummary>[]>(() => [
  {
    accessorKey: 'name',
    header: 'Key',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          'p',
          { class: 'font-medium text-highlighted truncate' },
          row.original.name || 'Untitled key'
        ),
        h(
          'p',
          { class: 'font-mono text-xs text-muted truncate' },
          `${row.original.start ?? row.original.prefix ?? ''}••••••••`
        )
      ])
  },
  {
    accessorKey: 'scope',
    header: 'Permission',
    meta: { class: { th: 'w-28 sm:w-32', td: 'w-28 sm:w-32' } },
    // A scope is a label (outline); full access is flagged as a warning (DESIGN.md §5).
    cell: ({ row }) =>
      h(
        UBadge,
        row.original.scope === 'full'
          ? { label: scopeLabel(row.original.scope), color: 'warning' }
          : { label: scopeLabel(row.original.scope), variant: 'outline' }
      )
  },
  {
    accessorKey: 'lastRequest',
    header: 'Last used',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.lastRequest, fallback: 'Never' })
  },
  {
    accessorKey: 'expiresAt',
    header: 'Expires',
    meta: {
      class: { th: 'w-32 hidden md:table-cell', td: 'w-32 hidden md:table-cell text-muted' }
    },
    cell: ({ row }) => {
      const { expiresAt } = row.original

      if (!expiresAt) return 'Never'

      if (isExpired(row.original)) return h(UBadge, { label: 'Expired', color: 'error' })

      return h('span', { class: 'tabular-nums' }, date(expiresAt))
    }
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    meta: {
      class: { th: 'w-40 hidden lg:table-cell', td: 'w-40 hidden lg:table-cell text-muted' }
    },
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(TimeAgo, { date: row.original.createdAt }),
        row.original.createdBy
          ? h(
              'p',
              { class: 'text-xs text-muted truncate', title: row.original.createdBy.email },
              `by ${row.original.createdBy.name || row.original.createdBy.email}`
            )
          : null
      ])
  },
  ...(canRevoke.value
    ? [rowActionsColumn({ items: rowActions, label: (key) => `Actions for ${key.name || 'key'}` })]
    : [])
])

const siteUrl = String(useRuntimeConfig().public.siteUrl || useRequestURL().origin).replace(
  /\/+$/,
  ''
)

const quickstart = computed(() =>
  [
    `curl ${siteUrl}/api/v1/emails \\`,
    `  -H "Authorization: Bearer ${lastCreatedStart.value ?? 'ml_'}..."`
  ].join('\n')
)
</script>

<template>
  <SettingsCard title="API keys" stacked>
    <template #description>
      Authenticate requests to the REST API from your servers. Keys belong to
      {{ organization?.name ?? 'the organization' }} and keep working when their creator leaves.
    </template>
    <template #headerActions>
      <Can v-slot="{ allowed }" :permission="{ apiKey: ['create'] }" :explain="NO_PERMISSION">
        <UTooltip text="Create key" :kbds="['n']" :disabled="!allowed">
          <UButton
            label="Create key"
            icon="i-lucide-plus"
            :disabled="!allowed"
            @click="openCreate"
          />
        </UTooltip>
      </Can>
    </template>

    <EmptyState
      v-if="error"
      variant="error"
      title="API keys could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton label="Retry" icon="i-lucide-refresh-cw" variant="outline" @click="refresh()" />
    </EmptyState>
    <UTable
      v-else-if="status === 'pending' || keys.length"
      :data="keys"
      :columns="columns"
      :loading="status === 'pending'"
      caption="API keys"
      :ui="tableUi"
    />
    <EmptyState
      v-else
      icon="i-lucide-key-round"
      title="No API keys yet"
      :description="
        canCreate
          ? 'Create a key to send email and manage contacts from your own code.'
          : 'Keys for the REST API appear here once a member with permission creates one.'
      "
      appearance="outline"
      compact
    >
      <UButton
        v-if="canCreate"
        label="Create key"
        icon="i-lucide-plus"
        variant="outline"
        @click="openCreate"
      />
    </EmptyState>
  </SettingsCard>

  <SettingsCard
    title="Quickstart"
    description="Send the key as a bearer token. Sending only keys can call the transactional email endpoints; full access keys can call every endpoint."
  >
    <CodeBlock :code="quickstart" label="cURL example" max-height="10rem" />
    <p class="text-[13px] text-muted">
      Keep keys on the server. Requests count against the per-key limit in
      <ULink to="/settings/limits" class="font-medium text-primary">Limits</ULink>.
    </p>
  </SettingsCard>
</template>
