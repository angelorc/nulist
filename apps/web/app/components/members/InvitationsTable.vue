<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { parseRoles, roleLabel } from '#shared/auth/permissions'
import type { PendingInvitation } from '#shared/schemas/members'

/**
 * Pending invitations with their row actions: re-send, copy the invitation
 * link (fallback when the organization cannot send email) and cancel. The page
 * decides what the viewer may do from their role.
 */
const props = defineProps<{
  invitations: PendingInvitation[]
  /** `invitation:create`: re-send and copy the link. */
  canInvite: boolean
  /** `invitation:cancel`. */
  canCancel: boolean
  /** Only owners re-send owner invitations (Better Auth enforces it too). */
  viewerIsOwner: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  resend: [invitation: PendingInvitation]
  cancel: [invitation: PendingInvitation]
}>()

const notify = useNotify()
const { copy } = useClipboard({ legacy: true })

async function copyLink(invitation: PendingInvitation) {
  await copy(invitation.url)
  notify.success('Invitation link copied', {
    description: `Send it to ${invitation.email}. It works until the invitation expires.`
  })
}

function rowActions(invitation: PendingInvitation): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = []
  const ownerInvite = parseRoles(invitation.role).includes('owner')

  if (props.canInvite) {
    groups.push([
      {
        label: invitation.expired ? 'Send a new invitation' : 'Resend invitation',
        icon: 'i-lucide-send',
        disabled: ownerInvite && !props.viewerIsOwner,
        onSelect: () => emit('resend', invitation)
      },
      {
        label: 'Copy invitation link',
        icon: 'i-lucide-link',
        disabled: invitation.expired,
        onSelect: () => copyLink(invitation)
      }
    ])
  }

  if (props.canCancel) {
    groups.push([
      {
        label: 'Cancel invitation',
        icon: 'i-lucide-x',
        color: 'error',
        onSelect: () => emit('cancel', invitation)
      }
    ])
  }

  return groups
}

const UBadge = resolveComponent('UBadge')
const TimeAgo = resolveComponent('TimeAgo')

const columns = computed<TableColumn<PendingInvitation>[]>(() => [
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'font-medium text-highlighted truncate' }, row.original.email),
        row.original.invitedBy
          ? h('p', { class: 'text-muted truncate' }, `Invited by ${row.original.invitedBy}`)
          : null
      ])
  },
  {
    accessorKey: 'role',
    header: 'Role',
    meta: { class: { th: 'w-24 sm:w-32', td: 'w-24 sm:w-32' } },
    // Roles are labels, not statuses (DESIGN.md §5).
    cell: ({ row }) => h(UBadge, { label: roleLabel(row.original.role), variant: 'outline' })
  },
  {
    accessorKey: 'expiresAt',
    header: 'Expires',
    meta: {
      class: { th: 'w-36 hidden sm:table-cell', td: 'w-36 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) =>
      row.original.expired
        ? h(UBadge, { label: 'Expired', color: 'warning' })
        : h(TimeAgo, { date: row.original.expiresAt })
  },
  rowActionsColumn({
    items: rowActions,
    label: (invitation) => `Actions for the invitation of ${invitation.email}`
  })
])
</script>

<template>
  <UTable
    :data="invitations"
    :columns="columns"
    :loading="loading"
    caption="Pending invitations"
    :ui="tableUi"
  />
</template>
