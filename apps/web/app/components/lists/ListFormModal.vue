<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { listInputSchema } from '#shared/schemas/lists'
import type { ListInput } from '#shared/schemas/lists'

/** Opened by callers that checked `list:create` (new) or `list:update` (edit). */
const props = defineProps<{ list?: { id: string } & Partial<ListInput> }>()
const emit = defineEmits<{ close: [saved: boolean] }>()

/** The saved list, as returned by POST and PATCH /api/lists. */
interface SavedList extends ListInput {
  id: string
}

/** The schema's input with the description held as text: an empty textarea clears it. */
interface ListFormState extends Omit<ListInput, 'description'> {
  description: string
}

const state = reactive<ListFormState>({
  name: props.list?.name ?? '',
  description: props.list?.description ?? '',
  optIn: props.list?.optIn ?? 'single',
  isPublic: props.list?.isPublic ?? true
})

const { run, pending } = useApiAction(
  (data: ListInput): Promise<SavedList> => {
    if (!props.list) return $fetch<SavedList>('/api/lists', { method: 'POST', body: data })
    const url: string = `/api/lists/${props.list.id}`

    return $fetch<SavedList>(url, { method: 'PATCH', body: data })
  },
  { success: props.list ? 'List updated' : 'List created' }
)

async function onSubmit(event: FormSubmitEvent<ListInput>) {
  if (await run(event.data)) emit('close', true)
}

const optInItems = [
  { label: 'Single opt-in', value: 'single', description: 'Contacts are subscribed immediately.' },
  {
    label: 'Double opt-in',
    value: 'double',
    description: 'Contacts confirm through an email link first.'
  }
]
</script>

<template>
  <UModal
    :title="list ? 'Edit list' : 'New list'"
    description="A list collects contacts who subscribe to the same broadcasts."
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template #body>
      <UForm
        id="list-form"
        :schema="listInputSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name" required>
          <UInput v-model="state.name" placeholder="Product updates" class="w-full" autofocus />
        </UFormField>
        <UFormField
          label="Description"
          name="description"
          help="Shown to contacts in the preference center."
        >
          <UTextarea v-model="state.description" :rows="2" autoresize class="w-full" />
        </UFormField>
        <UFormField label="Opt-in" name="optIn">
          <URadioGroup v-model="state.optIn" :items="optInItems" variant="table" />
        </UFormField>
        <UFormField name="isPublic">
          <USwitch
            v-model="state.isPublic"
            label="Public"
            description="Visible in the preference center and on the hosted subscribe form."
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', false)" />
      <UButton
        type="submit"
        form="list-form"
        :label="list ? 'Save' : 'Create list'"
        :loading="pending"
      />
    </template>
  </UModal>
</template>
