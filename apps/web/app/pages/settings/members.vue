<script setup lang="ts">
import { MembersInviteModal } from '#components'
import { ROLE_OPTIONS, parseRoles, roleLabel } from '#shared/auth/permissions'
import type { OrgRole } from '#shared/auth/permissions'
import type {
  MemberDirectory,
  OrganizationMember,
  PendingInvitation
} from '#shared/schemas/members'

definePageMeta({ permission: { member: ['read'] } })

useSeoMeta({ title: 'Members' })

const { organization, role, can } = useOrganization()
const organizationName = computed(() => organization.value?.name ?? 'this organization')

const canInvite = computed(() => can({ invitation: ['create'] }))
const canCancel = computed(() => can({ invitation: ['cancel'] }))
const viewerIsOwner = computed(() => parseRoles(role.value).includes('owner'))

const {
  data: directory,
  status,
  error,
  refresh
} = await useFetch<MemberDirectory>('/api/members', {
  default: () => ({ members: [], ownerCount: 0 })
})

const requestFetch = useRequestFetch()

// Only members who may invite can list invitations; the guard lives in the handler because
// refreshNuxtData() (organization switch) re-runs every handler.
const {
  data: invitations,
  status: invitationsStatus,
  error: invitationsError,
  refresh: refreshInvitations
} = await useAsyncData(
  () => `invitations:${organization.value?.id ?? 'none'}`,
  (): Promise<PendingInvitation[]> =>
    canInvite.value ? requestFetch<PendingInvitation[]>('/api/invitations') : Promise.resolve([]),
  { default: (): PendingInvitation[] => [] }
)

const members = computed(() => directory.value.members)
const confirm = useConfirm()
const inviteModal = useOverlay().create(MembersInviteModal)

async function openInvite() {
  const invitation = await inviteModal.open({
    canInviteOwner: viewerIsOwner.value,
    organizationName: organizationName.value
  }).result

  if (invitation) await refreshInvitations()
}

const { run: updateRole, pending: updatingRole } = useApiAction(
  (id: string, next: OrgRole) => {
    const url: string = `/api/members/${id}`

    return $fetch<OrganizationMember>(url, { method: 'PATCH', body: { role: next } })
  },
  {
    success: (member) => `${member.name} is now ${roleLabel(member.role)}`,
    error: 'Could not change the role'
  }
)

const { run: removeMember } = useApiAction(
  (id: string) => {
    const url: string = `/api/members/${id}`

    return $fetch<{ ok: true }>(url, { method: 'DELETE' })
  },
  { success: 'Member removed', error: 'Could not remove the member' }
)

const { run: resendInvitation } = useApiAction(
  (id: string) => {
    const url: string = `/api/invitations/${id}/resend`

    return $fetch<PendingInvitation>(url, { method: 'POST' })
  },
  {
    success: (invitation) => `Invitation sent again to ${invitation.email}`,
    error: 'Could not resend the invitation'
  }
)

const { run: cancelInvitation } = useApiAction(
  (id: string) => {
    const url: string = `/api/invitations/${id}`

    return $fetch<{ ok: true }>(url, { method: 'DELETE' })
  },
  { success: 'Invitation canceled', error: 'Could not cancel the invitation' }
)

async function onRoleChange(member: OrganizationMember, next: OrgRole) {
  if (next === member.role) return
  const option = ROLE_OPTIONS.find((item) => item.value === next)

  const ok = await confirm({
    title: `Make ${member.name} ${option?.label ?? next}?`,
    description: option
      ? `${option.description} The change applies on their next request.`
      : undefined,
    confirmLabel: 'Change role',
    danger: member.isOwner
  })

  if (ok && (await updateRole(member.id, next)) !== undefined) await refresh()
}

async function onRemove(member: OrganizationMember) {
  const ok = await confirm({
    title: `Remove ${member.name}?`,
    description: `${member.email} loses access to ${organizationName.value}. Their account and their other organizations are kept, and their past activity stays in the audit log.`,
    confirmLabel: 'Remove member',
    danger: true
  })

  if (ok && (await removeMember(member.id)) !== undefined) await refresh()
}

async function onResend(invitation: PendingInvitation) {
  if ((await resendInvitation(invitation.id)) !== undefined) await refreshInvitations()
}

async function onCancel(invitation: PendingInvitation) {
  const ok = await confirm({
    title: `Cancel the invitation of ${invitation.email}?`,
    description: 'The invitation link stops working. You can invite them again later.',
    confirmLabel: 'Cancel invitation',
    danger: true
  })

  if (ok && (await cancelInvitation(invitation.id)) !== undefined) await refreshInvitations()
}

defineShortcuts(computed(() => ({ n: canInvite.value ? () => void openInvite() : false })))

const summary = computed(() => {
  const count = members.value.length
  const owners = directory.value.ownerCount

  return `${count} ${count === 1 ? 'person' : 'people'}, ${owners} ${owners === 1 ? 'owner' : 'owners'}.`
})
</script>

<template>
  <SettingsCard title="Members" stacked>
    <template #description>
      Everyone who can sign in to {{ organizationName }}.
      <template v-if="members.length">
        {{ summary }}
      </template>
    </template>
    <template v-if="canInvite" #headerActions>
      <UTooltip text="Invite member" :kbds="['n']">
        <UButton label="Invite member" icon="i-lucide-user-plus" @click="openInvite" />
      </UTooltip>
    </template>

    <EmptyState
      v-if="error"
      variant="error"
      title="Members could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton label="Retry" icon="i-lucide-refresh-cw" variant="outline" @click="refresh()" />
    </EmptyState>
    <MembersTable
      v-else
      :members="members"
      :owner-count="directory.ownerCount"
      :my-role="role"
      :can-update="can({ member: ['update'] })"
      :can-delete="can({ member: ['delete'] })"
      :loading="status === 'pending'"
      :busy="updatingRole"
      @change-role="onRoleChange"
      @remove="onRemove"
    />
  </SettingsCard>

  <SettingsCard
    v-if="canInvite"
    title="Invitations"
    description="Pending invitations expire after 7 days. Copy the link if the email does not arrive."
    stacked
  >
    <EmptyState
      v-if="invitationsError"
      variant="error"
      title="Invitations could not be loaded"
      :description="apiErrorMessage(invitationsError)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        @click="refreshInvitations()"
      />
    </EmptyState>
    <EmptyState
      v-else-if="!invitations.length && invitationsStatus !== 'pending'"
      icon="i-lucide-mail"
      title="No pending invitations"
      description="Invite people by email; they choose their own password."
      appearance="outline"
      compact
    >
      <UButton
        label="Invite member"
        icon="i-lucide-user-plus"
        variant="outline"
        @click="openInvite"
      />
    </EmptyState>
    <MembersInvitationsTable
      v-else
      :invitations="invitations"
      :can-invite="canInvite"
      :can-cancel="canCancel"
      :viewer-is-owner="viewerIsOwner"
      :loading="invitationsStatus === 'pending'"
      @resend="onResend"
      @cancel="onCancel"
    />
  </SettingsCard>

  <SettingsCard
    title="Roles"
    description="Roles apply to this organization only. Changes take effect on the member's next request."
  >
    <dl class="divide-y divide-default">
      <div
        v-for="option in ROLE_OPTIONS"
        :key="option.value"
        class="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
      >
        <dt class="shrink-0 sm:w-24">
          <UBadge :label="option.label" variant="outline" />
        </dt>
        <dd class="text-[13px] text-muted">
          {{ option.description }}
        </dd>
      </div>
    </dl>
  </SettingsCard>
</template>
