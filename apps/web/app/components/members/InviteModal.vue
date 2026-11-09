<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { DEFAULT_INVITE_ROLE, ROLE_OPTIONS } from '#shared/auth/permissions'
import { invitationCreateSchema } from '#shared/schemas/members'
import type { InvitationCreateInput, PendingInvitation } from '#shared/schemas/members'

/** Invites someone by email with a role. Opened by callers that checked `invitation:create`. */
const props = defineProps<{
  /** Only owners may invite owners (Better Auth enforces it too). */
  canInviteOwner: boolean
  organizationName: string
}>()

const emit = defineEmits<{ close: [invitation: PendingInvitation | null] }>()

const state = reactive<InvitationCreateInput>({ email: '', role: DEFAULT_INVITE_ROLE })

const roleItems = computed(() =>
  ROLE_OPTIONS.flatMap((option) =>
    option.value !== 'owner' || props.canInviteOwner
      ? [{ value: option.value, label: option.label, description: option.description }]
      : []
  )
)

const { run, pending } = useApiAction(
  (input: InvitationCreateInput) =>
    $fetch<PendingInvitation>('/api/invitations', { method: 'POST', body: input }),
  {
    success: (invitation) => `Invitation sent to ${invitation.email}`,
    error: 'Could not send the invitation'
  }
)

async function onSubmit(event: FormSubmitEvent<InvitationCreateInput>) {
  const invitation = await run(event.data)

  if (invitation) emit('close', invitation)
}
</script>

<template>
  <UModal
    title="Invite member"
    :description="`They get an email with a link to join ${organizationName}.`"
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <UForm
        id="member-invite-form"
        :schema="invitationCreateSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Email" name="email" required>
          <UInput
            v-model="state.email"
            type="email"
            placeholder="name@company.com"
            autocomplete="off"
            class="w-full"
            autofocus
          />
        </UFormField>
        <UFormField label="Role" name="role" help="You can change it later.">
          <URadioGroup v-model="state.role" :items="roleItems" variant="table" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton type="submit" form="member-invite-form" label="Send invitation" :loading="pending" />
    </template>
  </UModal>
</template>
