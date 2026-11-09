<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { segmentInputSchema } from '#shared/schemas/segments'
import type { SegmentInput } from '#shared/schemas/segments'
import type { SegmentRules } from '#shared/types/domain'

export interface SegmentFormState {
  name: string
  /** Held as text: an empty textarea clears the description. */
  description: string
  rules: SegmentRules
}

/**
 * Full-page segment editor: details + rule builder on the left,
 * live count and preview in a sticky right rail. The page owns the
 * state and the submit button (`form="<id>"`). `readonly` shows the
 * segment without editing controls (members without segment:update).
 */
const props = defineProps<{ id: string; readonly?: boolean }>()
const state = defineModel<SegmentFormState>('state', { required: true })
const emit = defineEmits<{ submit: [data: SegmentInput] }>()

const form = useTemplateRef('form')

const { can } = useOrganization()

// The live count lists matching contacts.
const canPreview = computed(() => can({ contact: ['read'] }))

function onSubmit(event: FormSubmitEvent<SegmentInput>) {
  if (props.readonly) return
  emit('submit', event.data)
}

function onError() {
  // Bring the first invalid control into view (conditions can be far down).
  nextTick(() => document.querySelector<HTMLElement>(`#${props.id} [aria-invalid="true"]`)?.focus())
}

defineExpose({ submit: () => form.value?.submit() })
</script>

<template>
  <UForm
    :id="id"
    ref="form"
    :schema="segmentInputSchema"
    :state="state"
    :validate-on="['blur', 'change']"
    :disabled="readonly"
    class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
    @submit="onSubmit"
    @error="onError"
  >
    <div class="min-w-0 space-y-8">
      <section class="space-y-4">
        <h2 class="text-base font-semibold text-highlighted">Details</h2>
        <UFormField label="Name" name="name" required>
          <UInput
            v-model="state.name"
            placeholder="Engaged customers"
            class="w-full"
            :disabled="readonly"
            :autofocus="!readonly && !state.name"
          />
        </UFormField>
        <UFormField
          label="Description"
          name="description"
          help="Internal note, never shown to contacts."
        >
          <UTextarea
            v-model="state.description"
            :rows="2"
            autoresize
            class="w-full"
            :disabled="readonly"
          />
        </UFormField>
      </section>

      <USeparator />

      <section class="space-y-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">Conditions</h2>
          <p class="mt-1 text-sm text-muted">
            Membership is evaluated live, so the segment stays up to date as contacts change.
          </p>
        </div>
        <SegmentsSegmentRuleBuilder v-model="state.rules" name="rules" :readonly="readonly" />
      </section>
    </div>

    <aside v-if="canPreview" class="lg:sticky lg:top-0">
      <SegmentsSegmentLivePreview :rules="state.rules" />
    </aside>
  </UForm>
</template>
