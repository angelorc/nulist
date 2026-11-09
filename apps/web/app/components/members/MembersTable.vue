<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { ROLE_OPTIONS, parseRoles, roleLabel } from '#shared/auth/permissions'
import type { OrgRole } from '#shared/auth/permissions'
import type { OrganizationMember } from '#shared/schemas/members'

/**
 * Members of the organization. What the viewer may change is decided by the
 * page (`canUpdate` / `canDelete` from their role); the table adds the row
 * locks: their own row, owners (unless the viewer is an owner), the last owner.
 */
const props = defineProps<{
  members: OrganizationMember[]
  ownerCount: number
  /** The viewer's role in the organization. */
  myRole: string | null
  canUpdate: boolean
  canDelete: boolean
  loading?: boolean
  /** A role change is in flight. */
  busy?: boolean
}>()

const emit = defineEmits<{
  'change-role': [member: OrganizationMember, role: OrgRole]
  remove: [member: OrganizationMember]
}>()

const { date } = useFormat()
const viewerIsOwner = computed(() => parseRoles(props.myRole).includes('owner'))

const roleItems = computed(() =>
  ROLE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    // Only owners hand out the owner role.
    disabled: option.value === 'owner' && !viewerIsOwner.value
  }))
)

/** Why a row's role and removal are locked, or null when the viewer may change them. */
function lockReason(member: OrganizationMember): string | null {
  if (member.isCurrentUser) return "You can't change your own role or remove yourself."

  if (member.isOwner && !viewerIsOwner.value) return 'Only owners can change another owner.'

  if (member.isOwner && props.ownerCount <= 1) return 'The organization needs at least one owner.'

  return null
}

/** Row menu: removal, in its own destructive group; none for locked rows. */
function rowActions(member: OrganizationMember): DropdownMenuItem[][] {
  if (!props.canDelete || lockReason(member)) return []

  return [
    [
      {
        label: 'Remove from organization',
        icon: 'i-lucide-user-minus',
        color: 'error',
        onSelect: () => emit('remove', member)
      }
    ]
  ]
}

const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')
const USelect = resolveComponent('USelect')
const UTooltip = resolveComponent('UTooltip')
const TimeAgo = resolveComponent('TimeAgo')

/** Roles are labels, not statuses (DESIGN.md §5): neutral outline badges. */
function roleBadge(member: OrganizationMember) {
  return h(UBadge, { label: roleLabel(member.role), variant: 'outline' })
}

const columns = computed<TableColumn<OrganizationMember>[]>(() => [
  {
    accessorKey: 'name',
    header: 'Member',
    cell: ({ row }) =>
      h('div', { class: 'flex items-center gap-3 min-w-0' }, [
        h(UAvatar, {
          src: row.original.image ?? undefined,
          alt: row.original.name,
          size: 'sm',
          class: 'hidden sm:inline-flex'
        }),
        h('div', { class: 'min-w-0' }, [
          h('p', { class: 'flex items-center gap-1.5 font-medium text-highlighted' }, [
            h('span', { class: 'truncate' }, row.original.name),
            row.original.isCurrentUser ? h(UBadge, { label: 'You', variant: 'outline' }) : null,
            row.original.banned ? h(UBadge, { label: 'Banned', color: 'error' }) : null
          ]),
          h('p', { class: 'text-muted truncate' }, row.original.email)
        ])
      ])
  },
  {
    accessorKey: 'role',
    header: 'Role',
    meta: { class: { th: 'w-32 sm:w-36', td: 'w-32 sm:w-36' } },
    cell: ({ row }) => {
      const member = row.original
      const reason = lockReason(member)
      const single = parseRoles(member.role).length === 1

      if (!props.canUpdate || reason || !single) {
        // The tooltip trigger must be focusable for keyboard users to read why it is locked.
        return props.canUpdate && reason
          ? h(UTooltip, { text: reason }, () =>
              h('span', { class: 'inline-flex rounded-sm', tabindex: 0 }, [
                roleBadge(member),
                h('span', { class: 'sr-only' }, reason)
              ])
            )
          : roleBadge(member)
      }

      return h(USelect, {
        modelValue: member.role,
        items: roleItems.value,
        size: 'sm',
        variant: 'ghost',
        disabled: props.busy,
        class: 'w-28 -ms-2',
        'aria-label': `Role of ${member.name}`,
        'onUpdate:modelValue': (role: OrgRole) => emit('change-role', member, role)
      })
    }
  },
  {
    accessorKey: 'lastActiveAt',
    header: 'Last active',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.lastActiveAt, fallback: 'Never signed in' })
  },
  {
    accessorKey: 'createdAt',
    header: 'Joined',
    meta: {
      class: {
        th: 'w-32 hidden md:table-cell',
        td: 'w-32 hidden md:table-cell text-muted tabular-nums'
      }
    },
    cell: ({ row }) => date(row.original.createdAt)
  },
  rowActionsColumn({
    items: rowActions,
    label: (member) => `Actions for ${member.name}`
  })
])
</script>

<template>
  <UTable
    :data="members"
    :columns="columns"
    :loading="loading"
    caption="Members of the organization"
    :ui="tableUi"
  />
</template>
