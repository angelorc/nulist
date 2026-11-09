<script setup lang="ts">
import { OrganizationDeleteModal } from '#components'
import { parseRoles } from '#shared/auth/permissions'
import { organizationUpdateSchema } from '#shared/schemas/organization'
import type { ActiveOrganizationChange, MemberDirectory } from '#shared/schemas/members'
import type { OrganizationSummary } from '#shared/types/domain'

/** Any member may view it; changing it needs `organization:update`, deleting `organization:delete`. */
useSeoMeta({ title: 'Organization' })

const { organization, role, can, refresh } = useOrganization()

const canEdit = computed(() => can({ organization: ['update'] }))
const canDelete = computed(() => can({ organization: ['delete'] }))
const isOwner = computed(() => parseRoles(role.value).includes('owner'))

interface GeneralForm {
  name: string
  slug: string
}

const saved = computed<GeneralForm>(() => ({
  name: organization.value?.name ?? '',
  slug: organization.value?.slug ?? ''
}))

const state = reactive<GeneralForm>({ ...saved.value })

watch(saved, (value) => Object.assign(state, value))

const dirty = computed(() => state.name !== saved.value.name || state.slug !== saved.value.slug)
const slugChanged = computed(() => state.slug.trim() !== saved.value.slug)

const { run: save, pending: saving } = useApiAction(
  (input: GeneralForm) =>
    $fetch<OrganizationSummary>('/api/organization', { method: 'PATCH', body: input }),
  { success: 'Organization updated', error: 'Could not update the organization' }
)

async function onSubmit() {
  if (await save({ name: state.name, slug: state.slug })) await refresh()
}

function onDiscard() {
  Object.assign(state, saved.value)
}

// Owners need the owner count: the last owner cannot leave.
const { data: directory } = await useFetch<MemberDirectory>('/api/members', {
  immediate: isOwner.value,
  default: () => ({ members: [], ownerCount: 0 })
})

const isLastOwner = computed(() => isOwner.value && directory.value.ownerCount <= 1)

const confirm = useConfirm()
const deleteModal = useOverlay().create(OrganizationDeleteModal)

/** After leaving or deleting: the next organization, or the organization picker. */
async function moveOn(change: ActiveOrganizationChange) {
  await refresh()
  await refreshNuxtData()
  await navigateTo(change.organizationId ? '/' : '/no-organization')
}

const { run: leave, pending: leaving } = useApiAction(
  () => $fetch<ActiveOrganizationChange>('/api/organization/leave', { method: 'POST' }),
  { success: 'You left the organization', error: 'Could not leave the organization' }
)

async function onLeave() {
  if (!organization.value) return

  const ok = await confirm({
    title: `Leave ${organization.value.name}?`,
    description: 'You lose access to its data right away. A member must invite you to come back.',
    confirmLabel: 'Leave organization',
    danger: true
  })

  if (!ok) return
  const change = await leave()

  if (change) await moveOn(change)
}

async function onDelete() {
  if (!organization.value) return
  const change = await deleteModal.open({ organization: organization.value }).result

  if (change) await moveOn(change)
}

async function onLogoUpdated() {
  await refresh()
}
</script>

<template>
  <template v-if="organization">
    <SettingsCard
      title="General"
      description="The organization's name and the slug that identifies it on this instance."
      :schema="organizationUpdateSchema"
      :state="state"
      :dirty="dirty"
      :saving="saving"
      :readonly="!canEdit"
      @submit="onSubmit"
      @discard="onDiscard"
    >
      <UAlert
        v-if="!canEdit"
        icon="i-lucide-lock"
        title="Only owners and admins can change the organization."
      />
      <UFormField label="Name" name="name" required>
        <UInput v-model="state.name" class="w-full" />
      </UFormField>
      <UFormField
        label="Slug"
        name="slug"
        required
        :help="
          slugChanged
            ? 'Unsubscribe, preference and tracking links do not use the slug: they keep working.'
            : 'Lowercase letters, numbers and dashes. Unique on this instance.'
        "
      >
        <UInput
          v-model="state.slug"
          autocomplete="off"
          spellcheck="false"
          class="w-full"
          :ui="{ base: 'font-mono' }"
        />
      </UFormField>
    </SettingsCard>

    <SettingsCard
      title="Logo"
      description="Shown in the organization switcher and on invitation pages."
    >
      <OrganizationLogoField
        :organization="organization"
        :can-edit="canEdit"
        @updated="onLogoUpdated"
      />
    </SettingsCard>

    <SettingsCard
      v-if="!isLastOwner || canDelete"
      title="Danger zone"
      description="Leaving and deleting take effect immediately."
    >
      <UAlert
        v-if="isLastOwner"
        icon="i-lucide-info"
        title="You are the only owner"
        description="Make someone else an owner in Members before you can leave."
        :actions="[
          { label: 'Open members', to: '/settings/members', variant: 'outline', size: 'sm' }
        ]"
      />
      <div class="divide-y divide-default">
        <div
          v-if="!isLastOwner"
          class="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">Leave organization</p>
            <p class="text-[13px] text-muted">Your account and other organizations are kept.</p>
          </div>
          <UButton
            label="Leave organization"
            icon="i-lucide-log-out"
            color="error"
            variant="soft"
            :loading="leaving"
            @click="onLeave"
          />
        </div>
        <div
          v-if="canDelete"
          class="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">Delete organization</p>
            <p class="text-[13px] text-muted">
              Deletes all of its contacts, content, logs and settings for every member.
            </p>
          </div>
          <UButton
            label="Delete organization"
            icon="i-lucide-trash"
            color="error"
            variant="soft"
            @click="onDelete"
          />
        </div>
      </div>
    </SettingsCard>
  </template>
</template>
