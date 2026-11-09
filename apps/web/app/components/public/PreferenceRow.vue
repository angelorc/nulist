<script setup lang="ts">
import type { VNode } from 'vue'

/**
 * One list or topic of the preference center, as a list item: a horizontal UFormField
 * (name, badges, description and hint on the left, the switch on the right). UFormField
 * labels the switch and links the description and hint through aria-describedby.
 */
const model = defineModel<boolean | undefined>({ default: false })

const props = defineProps<{
  name: string
  description?: string | null
  disabled?: boolean
  /** Second line under the description: what happens next for this row. */
  hint?: string | null
}>()

defineSlots<{ badges?: () => VNode[] }>()

/**
 * The text UFormField describes the switch with. It links its description only when this
 * prop is set; the slot below renders the description and the hint on separate lines.
 */
const details = computed(
  () => [props.description, props.hint].filter(Boolean).join(' ') || undefined
)
</script>

<template>
  <UFormField
    as="li"
    :label="name"
    :description="details"
    orientation="horizontal"
    :ui="{
      root: 'place-items-start gap-4 py-3.5',
      wrapper: 'min-w-0 flex-1',
      label: 'flex flex-wrap items-center gap-x-2 gap-y-1 text-highlighted',
      description: 'mt-0.5 text-[13px] text-pretty',
      container: 'shrink-0 pt-0.5'
    }"
  >
    <template #label="{ label }">
      {{ label }}
      <slot name="badges" />
    </template>

    <template v-if="details" #description>
      <span v-if="description" class="block">{{ description }}</span>
      <span v-if="hint" class="block text-xs" :class="description && 'mt-1'">{{ hint }}</span>
    </template>

    <USwitch v-model="model" :disabled />
  </UFormField>
</template>
