<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { endpointFormToInput, webhookEndpointFormSchema } from '#shared/schemas/webhooks'
import type { WebhookEndpointForm, WebhookEndpointInput } from '#shared/schemas/webhooks'

const emit = defineEmits<{ close: [created: { id: string } | null] }>()

const state = reactive<WebhookEndpointForm>({
  url: '',
  description: '',
  allEvents: true,
  events: []
})

const { run, pending } = useApiAction(
  (body: WebhookEndpointInput) =>
    $fetch<{ id: string }>('/api/webhook-endpoints', { method: 'POST', body }),
  { success: 'Endpoint added' }
)

async function onSubmit(event: FormSubmitEvent<WebhookEndpointForm>) {
  const created = await run({ ...endpointFormToInput(event.data), enabled: true })

  if (created) emit('close', { id: created.id })
}
</script>

<template>
  <UModal
    title="Add endpoint"
    description="mlist sends a signed POST request to this URL for every subscribed event."
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="(v: boolean) => !v && emit('close', null)"
  >
    <template #body>
      <UForm
        id="endpoint-form"
        :schema="webhookEndpointFormSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Endpoint URL"
          name="url"
          required
          help="Use HTTPS in production. Respond with a 2xx status within 15 seconds."
        >
          <UInput
            v-model="state.url"
            type="url"
            placeholder="https://example.com/webhooks/mlist"
            class="w-full"
            :ui="{ base: 'font-mono text-[13px]' }"
            autofocus
          />
        </UFormField>
        <UFormField label="Description" name="description">
          <UInput v-model="state.description" placeholder="CRM sync" class="w-full" />
        </UFormField>
        <UFormField label="Events" name="events">
          <WebhooksEventPicker v-model:all="state.allEvents" v-model:events="state.events" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton type="submit" form="endpoint-form" label="Add endpoint" :loading="pending" />
    </template>
  </UModal>
</template>
