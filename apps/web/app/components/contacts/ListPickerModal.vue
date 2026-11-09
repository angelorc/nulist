<script lang="ts">
export interface ListPick {
  listId: string
  skipOptIn: boolean
}
</script>

<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    confirmLabel?: string
    /** `add` offers the opt-in choice for double opt-in lists. */
    mode?: 'add' | 'remove'
    /** Lists to hide (e.g. the ones the contact already belongs to). */
    exclude?: string[]
  }>(),
  { description: undefined, confirmLabel: 'Confirm', mode: 'add', exclude: () => [] }
)

const emit = defineEmits<{ close: [pick: ListPick | null] }>()

const pickSchema = z.object({
  listId: z.string({ error: 'Choose a list' }).min(1, 'Choose a list'),
  skipOptIn: z.boolean()
})

type PickState = z.input<typeof pickSchema>

const { data: lists, status } = useFetch('/api/lists', { default: () => [], server: false })
const { can } = useOrganization()
const canCreateLists = computed(() => can({ list: ['create'] }))

const state = reactive<Partial<PickState>>({ listId: undefined, skipOptIn: false })

const items = computed(() =>
  lists.value.flatMap((l) =>
    props.exclude.includes(l.id)
      ? []
      : [
          {
            label: l.name,
            value: l.id,
            description: l.optIn === 'double' ? 'Double opt-in' : 'Single opt-in'
          }
        ]
  )
)

const selected = computed(() => lists.value.find((l) => l.id === state.listId))
const isDouble = computed(() => props.mode === 'add' && selected.value?.optIn === 'double')
const empty = computed(() => status.value === 'success' && !items.value.length)

function onSubmit(event: FormSubmitEvent<z.output<typeof pickSchema>>) {
  emit('close', { listId: event.data.listId, skipOptIn: isDouble.value && event.data.skipOptIn })
}
</script>

<template>
  <UModal
    :title="title"
    :description="description ?? 'Choose the list these contacts belong to.'"
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <EmptyState
        v-if="empty"
        icon="i-lucide-list"
        title="No lists available"
        :description="
          canCreateLists
            ? 'Create a list first, then come back to add contacts to it.'
            : 'Ask a teammate who can manage lists to create one.'
        "
        compact
      >
        <UButton
          v-if="canCreateLists"
          label="Go to lists"
          variant="outline"
          to="/lists"
          @click="emit('close', null)"
        />
      </EmptyState>
      <UForm
        v-else
        id="list-picker-form"
        :schema="pickSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="List" name="listId" required>
          <USelectMenu
            v-model="state.listId"
            :items="items"
            value-key="value"
            :loading="status === 'pending'"
            placeholder="Choose a list"
            icon="i-lucide-list"
            class="w-full"
            autofocus
          />
        </UFormField>
        <UFormField v-if="isDouble" name="skipOptIn">
          <USwitch
            v-model="state.skipOptIn"
            label="Skip the confirmation email"
            description="Subscribe as confirmed. Only when you already have consent."
          />
        </UFormField>
        <p v-else-if="mode === 'add' && selected" class="text-[13px] text-muted">
          Active contacts are subscribed right away. Unsubscribed, bounced and blocked contacts are
          skipped.
        </p>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton
        v-if="!empty"
        type="submit"
        form="list-picker-form"
        :label="confirmLabel"
        :disabled="!state.listId"
      />
    </template>
  </UModal>
</template>
