<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import {
  SIMULATED_EVENT_LABELS,
  SIMULATED_EVENT_TYPES,
  simulateSesEventSchema
} from '#shared/schemas/webhooks'
import type { SimulateSesEventInput, SimulatedEventType } from '#shared/schemas/webhooks'

const props = defineProps<{ messageId?: string }>()
const emit = defineEmits<{ close: [ran: boolean] }>()

const state = reactive<{ messageId: string; type: SimulatedEventType; link: string }>({
  messageId: props.messageId ?? '',
  type: 'delivery',
  link: 'https://example.com/'
})

const typeItems = SIMULATED_EVENT_TYPES.map((value) => ({
  value,
  label: SIMULATED_EVENT_LABELS[value].label,
  description: SIMULATED_EVENT_LABELS[value].description
}))

interface SimulationResult {
  status: 'processed' | 'ignored' | 'failed'
  reason?: string
  eventType: string
}

const notify = useNotify()

const { run, pending } = useApiAction((body: SimulateSesEventInput) =>
  $fetch<SimulationResult>('/api/webhooks/ses/simulate', { method: 'POST', body })
)

async function onSubmit(event: FormSubmitEvent<SimulateSesEventInput>) {
  const result = await run({
    ...event.data,
    link: event.data.type === 'click' ? event.data.link : undefined
  })

  if (!result) return
  const title = `${result.eventType} event ${result.status}`

  if (result.status === 'processed') notify.success(title, { description: result.reason })
  else if (result.status === 'failed')
    notify.error(title, undefined, { description: result.reason })
  else notify.info(title, { description: result.reason })
  emit('close', true)
}
</script>

<template>
  <UModal
    title="Simulate an SES event"
    description="Runs a realistic Amazon SES event for a sent message through the real pipeline: statuses, suppressions, analytics and webhooks."
    @update:open="(v: boolean) => !v && emit('close', false)"
  >
    <template #body>
      <UForm
        id="simulate-form"
        :schema="simulateSesEventSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Message ID"
          name="messageId"
          required
          help="The nulist message ID, shown in the message log."
        >
          <UInput
            v-model="state.messageId"
            placeholder="01a1c0ea-…"
            class="w-full"
            :ui="{ base: 'font-mono text-[13px]' }"
            autofocus
          />
        </UFormField>
        <UFormField label="Event" name="type">
          <URadioGroup v-model="state.type" :items="typeItems" variant="table" size="sm" />
        </UFormField>
        <UFormField v-if="state.type === 'click'" label="Link" name="link">
          <UInput
            v-model="state.link"
            type="url"
            class="w-full"
            :ui="{ base: 'font-mono text-[13px]' }"
          />
        </UFormField>
        <UAlert
          color="warning"
          icon="i-lucide-triangle-alert"
          description="Bounces and complaints really suppress the address and update the contact. Use test messages."
        />
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', false)" />
      <UButton type="submit" form="simulate-form" label="Run event" :loading="pending" />
    </template>
  </UModal>
</template>
