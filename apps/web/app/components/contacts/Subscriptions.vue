<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { ContactSubscription } from '#shared/types/contacts'
import type { ContactStatus } from '#shared/types/domain'

type SubscribeResult = 'confirmed' | 'unconfirmed' | 'already_subscribed'

const props = defineProps<{
  contactId: string
  email: string
  contactStatus: ContactStatus
  subscriptions: ContactSubscription[]
  /** `contact:update`: subscribe, confirm, resend and unsubscribe actions. */
  canEdit?: boolean
}>()

const emit = defineEmits<{ changed: []; add: [] }>()

const confirm = useConfirm()

const listsUrl = computed<string>(() => `/api/contacts/${props.contactId}/lists`)

const { run: subscribe } = useApiAction(
  (listId: string, skipOptIn: boolean) =>
    $fetch<{ result: SubscribeResult }>(listsUrl.value, {
      method: 'POST',
      body: { listId, skipOptIn }
    }),
  {
    success: ({ result }) =>
      result === 'unconfirmed'
        ? 'Confirmation email sent'
        : result === 'already_subscribed'
          ? 'Already subscribed'
          : 'Subscribed'
  }
)

const { run: unsubscribe } = useApiAction(
  (listId: string) => $fetch<unknown>(listsUrl.value, { method: 'DELETE', body: { listId } }),
  { success: 'Unsubscribed from list' }
)

async function onUnsubscribe(sub: ContactSubscription) {
  const ok = await confirm({
    title: `Unsubscribe from "${sub.listName}"?`,
    description: `${props.email} stops receiving broadcasts sent to this list. Other lists are not affected.`,
    confirmLabel: 'Unsubscribe'
  })

  if (ok && (await unsubscribe(sub.listId)) !== undefined) emit('changed')
}

async function onResubscribe(sub: ContactSubscription) {
  const ok = await confirm({
    title: `Subscribe again to "${sub.listName}"?`,
    description:
      'This contact unsubscribed from this list before. Only continue if they asked to be added back.',
    confirmLabel: 'Subscribe again'
  })

  if (ok && (await subscribe(sub.listId, true))) emit('changed')
}

async function onConfirm(sub: ContactSubscription) {
  if (await subscribe(sub.listId, true)) emit('changed')
}

async function onResend(sub: ContactSubscription) {
  if (await subscribe(sub.listId, false)) emit('changed')
}

const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')
const NuxtLink = resolveComponent('NuxtLink')

function rowActions(sub: ContactSubscription): DropdownMenuItem[][] {
  if (sub.status === 'unsubscribed') {
    return [
      [
        {
          label: 'Subscribe again',
          icon: 'i-lucide-rotate-ccw',
          onSelect: () => onResubscribe(sub)
        }
      ]
    ]
  }

  const pending: DropdownMenuItem[] =
    sub.status === 'unconfirmed'
      ? [
          { label: 'Confirm now', icon: 'i-lucide-badge-check', onSelect: () => onConfirm(sub) },
          { label: 'Resend confirmation', icon: 'i-lucide-mail', onSelect: () => onResend(sub) }
        ]
      : []

  return [
    ...(pending.length ? [pending] : []),
    [{ label: 'Unsubscribe', icon: 'i-lucide-mail-x', onSelect: () => onUnsubscribe(sub) }]
  ]
}

const dataColumns: TableColumn<ContactSubscription>[] = [
  {
    accessorKey: 'listName',
    header: 'List',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          NuxtLink,
          {
            to: `/lists/${row.original.listId}`,
            class: 'font-medium text-highlighted hover:underline underline-offset-2 truncate block'
          },
          () => row.original.listName
        ),
        h(
          'p',
          { class: 'text-xs text-muted' },
          row.original.optIn === 'double' ? 'Double opt-in' : 'Single opt-in'
        )
      ])
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-28 sm:w-36', td: 'w-28 sm:w-36' } },
    cell: ({ row }) =>
      h(StatusBadge, {
        status: row.original.status,
        label: row.original.status === 'confirmed' ? 'Subscribed' : undefined
      })
  },
  {
    accessorKey: 'createdAt',
    header: 'Added',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 text-muted hidden sm:table-cell' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  },
  {
    id: 'changed',
    header: 'Changed',
    meta: {
      class: { th: 'w-32 hidden md:table-cell', td: 'w-32 text-muted hidden md:table-cell' }
    },
    cell: ({ row }) =>
      h(TimeAgo, {
        date:
          row.original.status === 'unsubscribed'
            ? row.original.unsubscribedAt
            : row.original.confirmedAt
      })
  }
]

const actionsColumn = rowActionsColumn<ContactSubscription>({
  items: rowActions,
  label: (sub) => `Actions for ${sub.listName}`
})

const columns = computed(() => (props.canEdit ? [...dataColumns, actionsColumn] : dataColumns))
</script>

<template>
  <div class="space-y-3">
    <UAlert
      v-if="contactStatus !== 'active' && subscriptions.some((s) => s.status !== 'unsubscribed')"
      icon="i-lucide-info"
      :title="`This contact is ${contactStatus}`"
      description="List memberships are kept, but no broadcast is sent until the contact is active again."
    />
    <UTable
      v-if="subscriptions.length"
      :data="subscriptions"
      :columns="columns"
      :ui="tableUi"
      caption="List subscriptions"
      class="shrink-0"
    />
    <EmptyState
      v-else
      icon="i-lucide-list"
      title="Not on any list"
      :description="
        canEdit
          ? 'Add this contact to a list so they receive its broadcasts.'
          : 'This contact is not subscribed to any list.'
      "
      appearance="outline"
    >
      <UButton
        v-if="canEdit"
        label="Add to list"
        icon="i-lucide-list-plus"
        variant="outline"
        @click="emit('add')"
      />
    </EmptyState>
  </div>
</template>
