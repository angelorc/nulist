<script setup lang="ts">
import { AdminOrganizationCreateModal } from '#components'
import { roleLabel } from '#shared/auth/permissions'
import type { ReceivedInvitation } from '#shared/schemas/members'
import { organizationAvatar } from '~/components/app/OrganizationAvatar.vue'

/**
 * Landing page for a signed-in user without an active organization: pick one
 * of their organizations, open a pending invitation, or (instance
 * administrators) create an organization.
 */
definePageMeta({ layout: 'auth' })

useSeoMeta({ title: 'No organization' })

const organization = useOrganization()

await organization.load()

if (organization.organization.value) await navigateTo('/', { replace: true })

const { user, signOut } = useUserSession()

const { data: invitations, status } = await useFetch<ReceivedInvitation[]>(
  '/api/invitations/mine',
  { default: () => [] }
)

/** The organization being opened, so only its button shows progress. */
const openingId = ref<string | null>(null)

const { run: switchTo, pending: switching } = useApiAction(
  (id: string) => organization.switchTo(id),
  { error: 'Could not open the organization' }
)

/** Opens an organization (errors are toasted by useApiAction). */
async function open(id: string) {
  openingId.value = id
  await switchTo(id)
  openingId.value = null
}

const createModal = useOverlay().create(AdminOrganizationCreateModal)

async function createOrganization() {
  const created = await createModal.open({ defaultOwnerEmail: user.value?.email }).result

  if (!created) return
  await organization.refresh()

  const isMember = organization.organizations.value.some(
    (item) => item.id === created.organization.id
  )

  if (isMember) await open(created.organization.id)
}

async function onSignOut() {
  await signOut({
    onSuccess: async () => {
      organization.clear()
      clearNuxtData()
      await navigateTo('/login')
    }
  })
}

const hasChoices = computed(
  () => organization.organizations.value.length > 0 || invitations.value.length > 0
)

const description = computed(() =>
  hasChoices.value
    ? 'Choose where to work, or accept an invitation.'
    : `Ask an organization owner or admin to invite ${user.value?.email ?? 'you'}, then open the link in the invitation email.`
)

const USER_UI = { root: 'flex-1 min-w-0', wrapper: 'min-w-0', name: 'truncate text-highlighted' }
</script>

<template>
  <UPageCard :description="description" class="w-full">
    <template #title>
      <h1>You're not in an organization</h1>
    </template>

    <section
      v-if="organization.organizations.value.length"
      aria-labelledby="organizations-heading"
      class="space-y-2"
    >
      <h2 id="organizations-heading" class="text-xs font-medium text-muted">Your organizations</h2>
      <ul class="divide-y divide-default rounded-md ring ring-default">
        <li
          v-for="item in organization.organizations.value"
          :key="item.id"
          class="flex items-center gap-3 px-3 py-2"
        >
          <UUser
            :name="item.name"
            :avatar="organizationAvatar(item.name, item.logo)"
            :ui="USER_UI"
          />
          <UButton
            label="Open"
            variant="outline"
            size="sm"
            :loading="openingId === item.id"
            :disabled="switching && openingId !== item.id"
            :aria-label="`Open ${item.name}`"
            @click="open(item.id)"
          />
        </li>
      </ul>
    </section>

    <section
      v-if="invitations.length || status === 'pending'"
      aria-labelledby="invitations-heading"
      class="space-y-2"
    >
      <h2 id="invitations-heading" class="text-xs font-medium text-muted">Pending invitations</h2>
      <div v-if="status === 'pending'" aria-busy="true">
        <USkeleton class="h-13 w-full rounded-md" />
      </div>
      <ul v-else class="divide-y divide-default rounded-md ring ring-default">
        <li
          v-for="invitation in invitations"
          :key="invitation.id"
          class="flex items-center gap-3 px-3 py-2"
        >
          <UUser
            :name="invitation.organizationName"
            :avatar="organizationAvatar(invitation.organizationName, invitation.organizationLogo)"
            :ui="USER_UI"
          >
            <template #description>
              <span class="block truncate">
                {{ roleLabel(invitation.role) }}
                <template v-if="invitation.inviterName">
                  · from {{ invitation.inviterName }}</template
                >
                · expires <TimeAgo :date="invitation.expiresAt" />
              </span>
            </template>
          </UUser>
          <UButton
            label="View"
            variant="outline"
            size="sm"
            :to="`/invitations/${invitation.id}`"
            :aria-label="`View invitation to ${invitation.organizationName}`"
          />
        </li>
      </ul>
    </section>

    <div class="flex flex-col gap-2">
      <template v-if="organization.isInstanceAdmin.value">
        <UButton
          label="Create organization"
          icon="i-lucide-plus"
          block
          @click="createOrganization"
        />
        <UButton
          label="All organizations"
          icon="i-lucide-building"
          variant="outline"
          block
          to="/admin/organizations"
        />
      </template>
      <UButton label="Sign out" icon="i-lucide-log-out" variant="ghost" block @click="onSignOut" />
    </div>
  </UPageCard>
</template>
