<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { adminOrganizationCreateSchema, slugify } from '#shared/schemas/organization'
import type {
  AdminOrganizationCreateInput,
  AdminOrganizationCreated
} from '#shared/schemas/organization'

/**
 * Creates an organization for an owner (instance administrators). The slug
 * follows the name until it is edited; an owner without an account is invited.
 */
const props = defineProps<{ defaultOwnerEmail?: string }>()

const emit = defineEmits<{ close: [created: AdminOrganizationCreated | null] }>()

const state = reactive<AdminOrganizationCreateInput>({
  name: '',
  slug: '',
  ownerEmail: props.defaultOwnerEmail ?? ''
})

const slugEdited = ref(false)

watch(
  () => state.name,
  (name) => {
    if (!slugEdited.value) state.slug = slugify(name)
  }
)

function onSlugInput() {
  slugEdited.value = state.slug.length > 0
}

const notify = useNotify()
const { copy } = useClipboard()

const { run, pending } = useApiAction(
  (input: AdminOrganizationCreateInput) =>
    $fetch<AdminOrganizationCreated>('/api/admin/organizations', { method: 'POST', body: input }),
  { error: 'Could not create the organization' }
)

async function onSubmit(event: FormSubmitEvent<AdminOrganizationCreateInput>) {
  const created = await run(event.data)

  if (!created) return

  const invitationUrl = created.invitationUrl

  notify.success(`Created ${created.organization.name}`, {
    description:
      created.owner === 'invited'
        ? `${event.data.ownerEmail} was invited as owner. You own it until they accept.`
        : `${event.data.ownerEmail} is its owner.`,
    actions: invitationUrl
      ? [
          {
            label: 'Copy invitation link',
            variant: 'outline',
            onClick: () => copy(invitationUrl)
          }
        ]
      : undefined
  })
  emit('close', created)
}
</script>

<template>
  <UModal
    title="Create organization"
    description="Each organization has its own audience, content, sending settings and members."
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <UForm
        id="admin-organization-form"
        :schema="adminOrganizationCreateSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name" required>
          <UInput v-model="state.name" placeholder="Acme Marketing" class="w-full" autofocus />
        </UFormField>
        <UFormField
          label="Slug"
          name="slug"
          required
          help="Lowercase letters, numbers and dashes. Unique on this instance."
        >
          <UInput
            v-model="state.slug"
            placeholder="acme-marketing"
            class="w-full"
            :ui="{ base: 'font-mono' }"
            spellcheck="false"
            autocomplete="off"
            @update:model-value="onSlugInput"
          />
        </UFormField>
        <UFormField
          label="Owner email"
          name="ownerEmail"
          required
          help="Without an account they get an invitation; you stay owner until they accept."
        >
          <UInput
            v-model="state.ownerEmail"
            type="email"
            placeholder="owner@company.com"
            class="w-full"
            autocomplete="off"
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton
        type="submit"
        form="admin-organization-form"
        label="Create organization"
        :loading="pending"
      />
    </template>
  </UModal>
</template>
