<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { slugifyTemplateName, templateCreateSchema } from '#shared/schemas/templates'
import type {
  TemplateCreateFormState,
  TemplateCreateInput,
  TemplateSaveResult
} from '#shared/schemas/templates'
import type { TemplateKind } from '#shared/types/domain'

const props = defineProps<{ kind?: TemplateKind }>()
const emit = defineEmits<{ close: [created: TemplateSaveResult | null] }>()

// Opened only from create-gated callers; the submit stays guarded on its own.
const { can } = useOrganization()
const canCreate = computed(() => can({ template: ['create'] }))

const state = reactive<TemplateCreateFormState>({
  name: '',
  kind: props.kind ?? 'marketing',
  editor: 'visual',
  slug: '',
  starter: 'default'
})

// Suggest a slug from the name until the user edits it.
const slugTouched = ref(false)

watch(
  () => state.name,
  (name) => {
    if (!slugTouched.value) state.slug = slugifyTemplateName(name)
  }
)

/** The slug field: typing in it stops the suggestion. */
const slug = computed({
  get: () => state.slug ?? '',
  set: (value: string) => {
    slugTouched.value = true
    state.slug = value
  }
})

const { run, pending } = useApiAction(
  (data: TemplateCreateInput) =>
    $fetch<TemplateSaveResult>('/api/templates', { method: 'POST', body: data }),
  { success: 'Template created' }
)

async function onSubmit(event: FormSubmitEvent<TemplateCreateInput>) {
  if (!canCreate.value) return

  const body: TemplateCreateInput = {
    ...event.data,
    slug: event.data.kind === 'transactional' ? event.data.slug : null
  }

  const created = await run(body)

  if (created) emit('close', created)
}

const kindItems = [
  {
    label: 'Marketing',
    value: 'marketing',
    description: 'Newsletters and broadcasts, with an unsubscribe footer.'
  },
  {
    label: 'Transactional',
    value: 'transactional',
    description: 'Receipts, resets and other email sent through the API.'
  }
]

const editorItems = [
  { label: 'Visual', value: 'visual', description: 'Drag and drop blocks.' },
  { label: 'Code', value: 'code', description: 'MJML with live preview.' }
]

const starterItems = [
  { label: 'Starter layout', value: 'default' },
  { label: 'Blank', value: 'blank' }
]
</script>

<template>
  <UModal
    title="New template"
    description="You can change the type and editor later."
    @update:open="(v: boolean) => !v && emit('close', null)"
  >
    <template #body>
      <UForm
        id="template-form"
        :schema="templateCreateSchema"
        :state="state"
        :validate-on="['blur', 'change']"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name" required>
          <UInput v-model="state.name" placeholder="Monthly newsletter" class="w-full" autofocus />
        </UFormField>

        <UFormField label="Type" name="kind">
          <URadioGroup v-model="state.kind" :items="kindItems" variant="table" />
        </UFormField>

        <UFormField
          v-if="state.kind === 'transactional'"
          label="Slug"
          name="slug"
          required
          help='Reference it from the API as template: "slug".'
        >
          <UInput
            v-model="slug"
            placeholder="password-reset"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="Editor" name="editor">
            <URadioGroup v-model="state.editor" :items="editorItems" />
          </UFormField>
          <UFormField label="Start from" name="starter">
            <URadioGroup v-model="state.starter" :items="starterItems" />
          </UFormField>
        </div>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton
        type="submit"
        form="template-form"
        label="Create template"
        :loading="pending"
        :disabled="!canCreate"
      />
    </template>
  </UModal>
</template>
