<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { organizationDeleteSchema } from '#shared/schemas/organization'
import type { OrganizationDeleteInput } from '#shared/schemas/organization'
import type { ActiveOrganizationChange } from '#shared/schemas/members'
import type { OrganizationSummary } from '#shared/types/domain'

/** Deletes the active organization once its slug is typed. Opened by owners (`organization:delete`). */
const props = defineProps<{ organization: OrganizationSummary }>()

const emit = defineEmits<{ close: [result: ActiveOrganizationChange | null] }>()

const state = reactive<OrganizationDeleteInput>({ confirmSlug: '' })
const confirmed = computed(() => state.confirmSlug.trim().toLowerCase() === props.organization.slug)

const { run, pending } = useApiAction(
  (input: OrganizationDeleteInput) =>
    $fetch<ActiveOrganizationChange>('/api/organization', { method: 'DELETE', body: input }),
  {
    success: `${props.organization.name} was deleted`,
    error: 'Could not delete the organization'
  }
)

async function onSubmit(event: FormSubmitEvent<OrganizationDeleteInput>) {
  if (!confirmed.value) return
  const result = await run(event.data)

  if (result) emit('close', result)
}
</script>

<template>
  <UModal
    :title="`Delete ${organization.name}?`"
    description="This can't be undone."
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          color="error"
          icon="i-lucide-triangle-alert"
          title="Everything in this organization is deleted permanently"
          description="Contacts, lists, segments, templates, files, broadcasts, sent message logs, webhooks, API keys and settings. Members keep their accounts and their other organizations."
        />
        <UForm
          id="organization-delete-form"
          :schema="organizationDeleteSchema"
          :state="state"
          @submit="onSubmit"
        >
          <UFormField name="confirmSlug">
            <template #label>
              Type <span class="font-mono text-highlighted">{{ organization.slug }}</span> to
              confirm
            </template>
            <UInput
              v-model="state.confirmSlug"
              autocomplete="off"
              spellcheck="false"
              autofocus
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
        </UForm>
      </div>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton
        type="submit"
        form="organization-delete-form"
        label="Delete organization"
        color="error"
        :disabled="!confirmed"
        :loading="pending"
      />
    </template>
  </UModal>
</template>
