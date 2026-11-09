<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { topicInputSchema } from '#shared/schemas/topics'
import type { TopicInput, TopicInputState } from '#shared/schemas/topics'

interface EditableTopic {
  id: string
  name: string
  description: string | null
  defaultSubscribed: boolean
}

/** The schema's input with the description held as text: an empty textarea clears it. */
interface TopicFormState extends Omit<TopicInputState, 'description'> {
  description: string
}

/** Create or edit a topic. Callers open it only with topic:create / topic:update. */
const props = defineProps<{ topic?: EditableTopic }>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const state = reactive<TopicFormState>({
  name: props.topic?.name ?? '',
  description: props.topic?.description ?? '',
  defaultSubscribed: props.topic?.defaultSubscribed ?? true
})

const { run, pending } = useApiAction(
  (data: TopicInput): Promise<EditableTopic> => {
    if (!props.topic) return $fetch<EditableTopic>('/api/topics', { method: 'POST', body: data })
    const url: string = `/api/topics/${props.topic.id}`

    return $fetch<EditableTopic>(url, { method: 'PATCH', body: data })
  },
  { success: props.topic ? 'Topic updated' : 'Topic created' }
)

async function onSubmit(event: FormSubmitEvent<TopicInput>) {
  if (await run(event.data)) emit('close', true)
}
</script>

<template>
  <UModal
    :title="topic ? 'Edit topic' : 'New topic'"
    description="Topics let contacts choose which kinds of email they receive in the preference center."
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template #body>
      <UForm
        id="topic-form"
        :schema="topicInputSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
          help="Shown to contacts in the preference center."
        >
          <UInput v-model="state.name" placeholder="Product updates" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Description" name="description">
          <UTextarea
            v-model="state.description"
            :rows="2"
            autoresize
            placeholder="New features and improvements, about once a month."
            class="w-full"
          />
        </UFormField>
        <UFormField name="defaultSubscribed">
          <USwitch
            v-model="state.defaultSubscribed"
            label="Subscribed by default"
            :description="
              state.defaultSubscribed
                ? 'Contacts receive this topic until they opt out.'
                : 'Opt-in only: contacts receive this topic after they choose it.'
            "
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', false)" />
      <UButton
        type="submit"
        form="topic-form"
        :label="topic ? 'Save' : 'Create topic'"
        :loading="pending"
      />
    </template>
  </UModal>
</template>
