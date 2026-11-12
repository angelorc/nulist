<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { slugifyTemplateName, templateCreateSchema } from '#shared/schemas/templates'
import type {
  StarterPreviewDto,
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
  { label: 'Visual', value: 'visual', description: 'Drag and drop blocks. No code needed.' },
  { label: 'Code', value: 'code', description: 'Write MJML, with a live preview.' }
]

// Ready-made emails of the chosen type, previewed with sample values.
const { data: starters, status: startersStatus } = useFetch<StarterPreviewDto[]>(
  '/api/templates/starters',
  {
    query: computed(() => ({ kind: state.kind })),
    default: () => []
  }
)

/** The gallery's selection (`default` is the API's shorthand and never shown). */
const starterChoice = computed({
  get: () => (state.starter === 'default' ? undefined : state.starter),
  set: (value: StarterPreviewDto['id'] | undefined) => {
    state.starter = value ?? 'default'
  }
})

// A new type has its own starters. Until they load, "default" stands for the type's
// general-purpose one, so creating right away never uses the other type's starter.
// Blank fits both types and stays selected.
watch(
  () => state.kind,
  () => {
    if (state.starter !== 'blank') state.starter = 'default'
  }
)

// Once loaded, keep the choice if the list has it, else select the first starter.
watch(
  starters,
  (list) => {
    if (!list.some((starter) => starter.id === state.starter)) starterChoice.value = list[0]?.id
  },
  { immediate: true }
)

const starterItems = computed(() =>
  starters.value.map((starter) => ({
    value: starter.id,
    label: starter.name,
    description: starter.description,
    previewHtml: starter.previewHtml
  }))
)

const starterUi = {
  fieldset: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
  item: 'p-0 overflow-hidden has-data-[state=checked]:ring-2 has-data-[state=checked]:ring-primary',
  wrapper: 'w-full text-start items-stretch gap-0',
  label: 'block',
  description: 'px-3 pb-3 text-xs'
}
</script>

<template>
  <UModal
    title="New template"
    description="Pick a ready-made email to start from. You can change everything later."
    :ui="{ content: 'sm:max-w-3xl' }"
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

        <UFormField label="Start from" name="starter">
          <div v-if="startersStatus === 'pending'" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <USkeleton v-for="n in 6" :key="n" class="h-56 rounded-lg" />
          </div>
          <URadioGroup
            v-else
            v-model="starterChoice"
            :items="starterItems"
            variant="card"
            indicator="hidden"
            :ui="starterUi"
          >
            <template #label="{ item }">
              <span class="relative block h-40 border-b border-default bg-elevated/40">
                <TemplatesThumbnail v-if="item.previewHtml" :html="item.previewHtml" />
                <span v-else class="absolute inset-0 grid place-items-center">
                  <UIcon name="i-lucide-square-dashed" class="size-8 text-dimmed" />
                </span>
              </span>
              <span class="block px-3 pt-2.5 pb-0.5 font-medium text-highlighted">
                {{ item.label }}
              </span>
            </template>
          </URadioGroup>
        </UFormField>

        <UFormField label="Editor" name="editor">
          <URadioGroup
            v-model="state.editor"
            :items="editorItems"
            orientation="horizontal"
            variant="card"
          />
        </UFormField>
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
