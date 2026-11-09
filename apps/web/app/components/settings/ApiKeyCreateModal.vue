<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import {
  API_KEY_EXPIRY_OPTIONS,
  API_KEY_SCOPE_OPTIONS,
  apiKeyCreateSchema
} from '#shared/schemas/api-keys'
import type { ApiKeyCreateInput, CreatedApiKey } from '#shared/schemas/api-keys'

/**
 * Two steps: describe the key, then reveal the secret exactly once. Closes with
 * the created key (or null). Opened only for members with `apiKey:create`; the
 * key belongs to the active organization.
 */
const emit = defineEmits<{ close: [created: CreatedApiKey | null] }>()

type ExpiryDays = (typeof API_KEY_EXPIRY_OPTIONS)[number]['value']

const state = reactive<{
  name: string
  scope: ApiKeyCreateInput['scope']
  expiresInDays: ExpiryDays
}>({
  name: '',
  scope: 'sending',
  expiresInDays: 0
})

const scopeItems = [...API_KEY_SCOPE_OPTIONS]
const expiryItems = [...API_KEY_EXPIRY_OPTIONS]

const created = ref<CreatedApiKey | null>(null)
const acknowledged = ref(false)
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })

const { run, pending } = useApiAction(
  (body: ApiKeyCreateInput) => $fetch<CreatedApiKey>('/api/api-keys', { method: 'POST', body }),
  { error: 'Could not create the API key' }
)

async function onSubmit(event: FormSubmitEvent<ApiKeyCreateInput>) {
  const key = await run(event.data)

  if (key) created.value = key
}

async function copyKey() {
  if (!created.value) return
  await copy(created.value.key)
  acknowledged.value = true
}

function selectAll(event: FocusEvent) {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

function finish() {
  emit('close', created.value)
}
</script>

<template>
  <UModal
    :title="created ? 'Copy your API key' : 'Create API key'"
    :description="
      created
        ? 'This is the only time the full key is shown.'
        : 'Keys authenticate requests to the mlist REST API.'
    "
    :dismissible="!created"
    :close="!created"
    @update:open="(open: boolean) => !open && finish()"
  >
    <template #body>
      <div v-if="created" class="space-y-4">
        <UFormField :label="created.name || 'API key'" name="key">
          <UFieldGroup class="w-full">
            <UInput
              :model-value="created.key"
              readonly
              autocomplete="off"
              spellcheck="false"
              class="min-w-0 flex-1"
              :ui="{ base: 'font-mono' }"
              data-testid="api-key-secret"
              @focus="selectAll"
            />
            <UButton
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copied ? 'Copied' : 'Copy'"
              variant="outline"
              @click="copyKey"
            />
          </UFieldGroup>
          <span class="sr-only" aria-live="polite">{{ copied ? 'API key copied' : '' }}</span>
        </UFormField>
        <UAlert
          color="warning"
          icon="i-lucide-triangle-alert"
          title="Store it somewhere safe"
          description="mlist keeps only a hash. If you lose the key, revoke it and create a new one. Never put it in browser code or a public repository."
        />
        <UCheckbox v-model="acknowledged" label="I have copied the key" />
      </div>

      <UForm
        v-else
        id="api-key-create-form"
        :schema="apiKeyCreateSchema"
        :state="state"
        class="space-y-5"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
          help="Where the key is used, such as Production backend."
        >
          <UInput
            v-model="state.name"
            placeholder="Production backend"
            autocomplete="off"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UFormField label="Permission" name="scope">
          <URadioGroup v-model="state.scope" :items="scopeItems" variant="table" />
        </UFormField>
        <UFormField
          label="Expires"
          name="expiresInDays"
          help="Short-lived keys limit the damage if one leaks."
        >
          <USelect v-model="state.expiresInDays" :items="expiryItems" class="w-full sm:w-48" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <UButton v-if="created" label="Done" :disabled="!acknowledged" @click="finish" />
      <template v-else>
        <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
        <UButton type="submit" form="api-key-create-form" label="Create key" :loading="pending" />
      </template>
    </template>
  </UModal>
</template>
