<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent, TableColumn } from '@nuxt/ui'
import {
  SUPPRESSION_REASONS,
  SUPPRESSION_REASON_LABELS,
  suppressionInputSchema
} from '#shared/schemas/suppressions'
import type { SuppressionInput } from '#shared/schemas/suppressions'
import type { ContactStatus, Paginated, SuppressionReason } from '#shared/types/domain'

definePageMeta({ permission: { suppression: ['read'] } })

useSeoMeta({ title: 'Suppressions' })

const { can } = useOrganization()
const canAdd = computed(() => can({ suppression: ['create'] }))
const canRemove = computed(() => can({ suppression: ['delete'] }))
const ADD_DENIED = "You don't have permission to suppress addresses"

type SuppressionFilters = { reason: string | undefined }

interface SuppressionRow {
  id: string
  email: string
  reason: SuppressionReason
  source: string | null
  createdAt: string
  contactId: string | null
  contactStatus: ContactStatus | null
}

type SuppressionPage = Paginated<SuppressionRow> & {
  counts: Partial<Record<SuppressionReason, number>>
}

const {
  page,
  pageSize,
  q,
  filters,
  items,
  total,
  loading,
  error,
  refresh,
  isFiltered,
  clearFilters
} = usePaginatedList<SuppressionRow, SuppressionFilters>('/api/suppressions', {
  filters: { reason: undefined },
  key: 'suppressions'
})

// The list endpoint also returns per-reason totals (unfiltered) for the filter labels.
const { data: rawPage } = useNuxtData<SuppressionPage>('suppressions')
const counts = computed(() => rawPage.value?.counts ?? {})
const { number } = useFormat()

const totalSuppressed = computed(() =>
  Object.values(counts.value).reduce((sum, n) => sum + (n ?? 0), 0)
)

const reasonItems = computed(() => [
  { label: 'All reasons', value: 'all' },
  ...SUPPRESSION_REASONS.map((value) => ({
    label: `${SUPPRESSION_REASON_LABELS[value].label} (${number(counts.value[value] ?? 0)})`,
    value
  }))
])

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------
const addOpen = ref(false)
const addState = reactive<{ email: string }>({ email: '' })

const { run: add, pending: adding } = useApiAction(
  (body: SuppressionInput) => $fetch<unknown>('/api/suppressions', { method: 'POST', body }),
  { success: 'Address suppressed', error: 'Could not suppress the address' }
)

function openAdd() {
  if (!canAdd.value) return
  addState.email = ''
  addOpen.value = true
}

async function onAdd(event: FormSubmitEvent<SuppressionInput>) {
  if ((await add({ email: event.data.email, reason: 'manual' })) === undefined) return
  addOpen.value = false
  await refresh()
}

const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts(
  computed(() => ({
    n: canAdd.value ? openAdd : false,
    '/': () => searchInput.value?.inputRef?.focus()
  }))
)

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------
const confirm = useConfirm()

const { run: removeRequest } = useApiAction(
  (email: string) =>
    $fetch<unknown>(`/api/suppressions/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  { success: 'Removed from the suppression list', error: 'Could not remove the address' }
)

const CONTACT_STATUS_NOTE: Partial<Record<ContactStatus, string>> = {
  bounced: 'bounced',
  complained: 'complained',
  unsubscribed: 'unsubscribed',
  blocklisted: 'blocklisted'
}

async function onRemove(row: SuppressionRow) {
  const status = row.contactStatus ? CONTACT_STATUS_NOTE[row.contactStatus] : undefined

  const description = status
    ? `nulist can email this address again. The contact keeps its status (${status}), so broadcasts still skip it until you change the status on the contact.`
    : 'nulist can email this address again, including broadcasts if it belongs to a contact on your lists.'

  const ok = await confirm({
    title: `Remove ${row.email} from the suppression list?`,
    description,
    confirmLabel: 'Remove from list',
    danger: true
  })

  if (ok && (await removeRequest(row.email)) !== undefined) await refresh()
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
/** Row menu: lifting the block, in its own destructive group. */
function rowActions(row: SuppressionRow): DropdownMenuItem[][] {
  return canRemove.value
    ? [
        [
          {
            label: 'Remove from list',
            icon: 'i-lucide-trash',
            color: 'error',
            onSelect: () => onRemove(row)
          }
        ]
      ]
    : []
}

const UBadge = resolveComponent('UBadge')
const UTooltip = resolveComponent('UTooltip')
const NuxtLink = resolveComponent('NuxtLink')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

const columns = computed<TableColumn<SuppressionRow>[]>(() => [
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => {
      const { email, contactId, source } = row.original

      return h('div', { class: 'min-w-0' }, [
        contactId
          ? h(
              NuxtLink,
              {
                to: `/contacts/${contactId}`,
                class:
                  'block truncate font-medium text-highlighted hover:underline underline-offset-4'
              },
              () => email
            )
          : h('p', { class: 'truncate font-medium text-highlighted' }, email),
        source ? h('p', { class: 'truncate text-xs text-muted', title: source }, source) : null
      ])
    }
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    meta: { class: { th: 'w-28 sm:w-32', td: 'w-28 sm:w-32' } },
    cell: ({ row }) => {
      const meta = SUPPRESSION_REASON_LABELS[row.original.reason]
      const hint = `${meta.description}. Blocks ${meta.blocksTransactional ? 'all email' : 'marketing email only'}.`

      // The hint is also in sr-only text: a tooltip on a static badge is pointer-only.
      return h('span', { class: 'inline-flex' }, [
        h(UTooltip, { text: hint }, () => h(UBadge, { label: meta.label, variant: 'outline' })),
        h('span', { class: 'sr-only' }, hint)
      ])
    }
  },
  {
    accessorKey: 'contactStatus',
    header: 'Contact',
    meta: { class: { th: 'w-32 hidden md:table-cell', td: 'w-32 hidden md:table-cell' } },
    cell: ({ row }) =>
      row.original.contactStatus
        ? h(StatusBadge, { status: row.original.contactStatus })
        : emptyCell()
  },
  {
    accessorKey: 'createdAt',
    header: 'Added',
    meta: {
      class: { th: 'w-28 hidden sm:table-cell', td: 'w-28 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  },
  ...(canRemove.value
    ? [rowActionsColumn({ items: rowActions, label: (row) => `Actions for ${row.email}` })]
    : [])
])
</script>

<template>
  <SettingsCard
    title="Suppression list"
    description="Addresses nulist never emails. Hard bounces, complaints and global unsubscribes are added automatically from provider events; soft bounces once an address keeps failing."
    stacked
  >
    <template #headerActions>
      <Can v-slot="{ allowed }" :permission="{ suppression: ['create'] }" :explain="ADD_DENIED">
        <UTooltip text="Add address" :kbds="['n']" :disabled="!allowed">
          <UButton label="Add address" icon="i-lucide-plus" :disabled="!allowed" @click="openAdd" />
        </UTooltip>
      </Can>
    </template>

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        ref="search"
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search email…"
        aria-label="Search suppressed addresses"
        class="w-full sm:w-64"
      >
        <template #trailing>
          <UKbd value="/" />
        </template>
      </UInput>
      <USelect
        v-model="filters.reason"
        :items="reasonItems"
        placeholder="All reasons"
        aria-label="Filter by reason"
        class="w-full sm:w-48"
      />
      <UButton
        v-if="isFiltered"
        label="Clear filters"
        variant="ghost"
        size="sm"
        @click="clearFilters"
      />
      <p v-if="totalSuppressed" class="text-[13px] text-muted tabular-nums sm:ms-auto">
        {{ number(totalSuppressed) }} suppressed in total
      </p>
    </div>

    <EmptyState
      v-if="error"
      variant="error"
      title="The suppression list could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        :loading="loading"
        @click="() => refresh()"
      />
    </EmptyState>
    <UTable
      v-else-if="loading || items.length"
      :data="items"
      :columns="columns"
      :loading="loading"
      caption="Suppressed addresses"
      :ui="tableUi"
    />
    <EmptyState
      v-else-if="isFiltered"
      variant="no-results"
      title="No suppressed addresses match your filters"
      appearance="outline"
      compact
    >
      <UButton label="Clear filters" variant="outline" @click="clearFilters" />
    </EmptyState>
    <EmptyState
      v-else
      icon="i-lucide-shield-check"
      title="No suppressed addresses"
      description="Your list is clean. Addresses that bounce or complain show up here automatically."
      appearance="outline"
      compact
    >
      <UButton
        v-if="canAdd"
        label="Add address"
        icon="i-lucide-plus"
        variant="outline"
        @click="openAdd"
      />
    </EmptyState>

    <TableFooter
      v-if="!error"
      v-model:page="page"
      :total="total"
      :page-size="pageSize"
      noun="address"
      noun-plural="addresses"
    />
  </SettingsCard>

  <SettingsCard
    title="How suppressions apply"
    description="Each reason blocks either every email or marketing email only."
  >
    <ul class="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      <li v-for="reason in SUPPRESSION_REASONS" :key="reason" class="flex items-start gap-2">
        <UIcon
          :name="
            SUPPRESSION_REASON_LABELS[reason].blocksTransactional
              ? 'i-lucide-ban'
              : 'i-lucide-megaphone-off'
          "
          class="mt-0.5 size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        <span class="min-w-0">
          <span class="font-medium text-highlighted">{{
            SUPPRESSION_REASON_LABELS[reason].label
          }}</span>
          <span class="text-muted">
            ·
            {{
              SUPPRESSION_REASON_LABELS[reason].blocksTransactional
                ? 'blocks all email'
                : 'blocks marketing only'
            }}</span
          >
        </span>
      </li>
    </ul>
    <p class="text-[13px] text-muted">
      Removing an address lifts the send block only. The contact keeps its status, so change it on
      the contact if it should receive broadcasts again.
    </p>
  </SettingsCard>

  <UModal
    v-model:open="addOpen"
    title="Suppress an address"
    description="nulist will not send any email to it, including transactional email."
  >
    <template #body>
      <UForm
        id="suppression-form"
        :schema="suppressionInputSchema"
        :state="addState"
        @submit="onAdd"
      >
        <UFormField label="Email" name="email" required>
          <UInput
            v-model="addState.email"
            type="email"
            placeholder="someone@example.com"
            autocomplete="off"
            class="w-full"
            autofocus
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="addOpen = false" />
      <UButton type="submit" form="suppression-form" label="Suppress" :loading="adding" />
    </template>
  </UModal>
</template>
