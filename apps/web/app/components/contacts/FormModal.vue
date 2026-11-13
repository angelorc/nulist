<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { contactCreateSchema } from '#shared/schemas/contacts'
import type { ContactCreateData } from '#shared/schemas/contacts'

/** Opened by callers that checked `contact:create`. */
const props = defineProps<{ listId?: string }>()
const emit = defineEmits<{ close: [contactId: string | null] }>()

interface ContactFormState {
  email: string
  firstName: string
  lastName: string
  listIds: string[]
  skipOptIn: boolean
}

const { data: lists, status: listsStatus } = useFetch('/api/lists', {
  default: () => [],
  server: false
})

const state = reactive<ContactFormState>({
  email: '',
  firstName: '',
  lastName: '',
  listIds: props.listId ? [props.listId] : [],
  skipOptIn: false
})

const listItems = computed(() =>
  lists.value.map((l) => ({
    label: l.name,
    value: l.id,
    description: l.optIn === 'double' ? 'Double opt-in' : undefined
  }))
)

const selectsDoubleOptIn = computed(() =>
  lists.value.some((l) => l.optIn === 'double' && state.listIds.includes(l.id))
)

const listsHelp = computed(() =>
  selectsDoubleOptIn.value
    ? 'Double opt-in lists send a confirmation email first.'
    : 'Optional. The contact is subscribed right away.'
)

const listMenuOpen = ref(false)
const listMenuContent = { disableOutsidePointerEvents: true }

watch(
  () => state.listIds.length,
  () => {
    listMenuOpen.value = false
  }
)

const { run, pending } = useApiAction(
  (body: ContactCreateData) => $fetch<{ id: string }>('/api/contacts', { method: 'POST', body }),
  { success: 'Contact added' }
)

async function onSubmit(event: FormSubmitEvent<ContactCreateData>) {
  const contact = await run({
    ...event.data,
    skipOptIn: selectsDoubleOptIn.value ? state.skipOptIn : undefined
  })

  if (contact) emit('close', contact.id)
}
</script>

<template>
  <UModal
    title="Add contact"
    description="Create a single contact. Use Import for many."
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <UForm
        id="contact-form"
        :schema="contactCreateSchema"
        :state="state"
        class="space-y-4"
        novalidate
        @submit="onSubmit"
      >
        <UFormField label="Email" name="email" required>
          <UInput
            v-model="state.email"
            type="email"
            placeholder="jane@example.com"
            autocomplete="off"
            class="w-full"
            autofocus
          />
        </UFormField>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="First name" name="firstName">
            <UInput v-model="state.firstName" placeholder="Jane" class="w-full" />
          </UFormField>
          <UFormField label="Last name" name="lastName">
            <UInput v-model="state.lastName" placeholder="Doe" class="w-full" />
          </UFormField>
        </div>
        <UFormField
          label="Lists"
          name="listIds"
          :help="listsHelp"
        >
          <USelectMenu
            v-model="state.listIds"
            :items="listItems"
            value-key="value"
            v-model:open="listMenuOpen"
            multiple
            :content="listMenuContent"
            :loading="listsStatus === 'pending'"
            placeholder="No lists"
            icon="i-lucide-list"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="selectsDoubleOptIn" name="skipOptIn">
          <USwitch
            v-model="state.skipOptIn"
            label="Skip the confirmation email"
            description="Only when you already have consent. Otherwise the contact confirms from an email first."
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton type="submit" form="contact-form" label="Add contact" :loading="pending" />
    </template>
  </UModal>
</template>
