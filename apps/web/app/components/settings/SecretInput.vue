<script setup lang="ts">
import { MASKED_SECRET } from '#shared/schemas/settings'

/**
 * Password-style input for stored secrets. The server sends a mask instead of
 * the secret; leaving the mask untouched keeps the stored value.
 */
const model = defineModel<string>({ required: true })

defineProps<{ placeholder?: string; disabled?: boolean }>()

const visible = ref(false)
const isStored = computed(() => model.value === MASKED_SECRET)

function onFocus(event: FocusEvent) {
  if (isStored.value && event.target instanceof HTMLInputElement) event.target.select()
}

function clear() {
  model.value = ''
  visible.value = false
}
</script>

<template>
  <UInput
    v-model="model"
    :type="visible && !isStored ? 'text' : 'password'"
    :placeholder="placeholder"
    :disabled="disabled"
    autocomplete="new-password"
    spellcheck="false"
    class="w-full"
    :ui="{ base: 'font-mono', trailing: 'pe-1' }"
    @focus="onFocus"
  >
    <template #trailing>
      <template v-if="isStored">
        <UTooltip text="Stored securely. Type to replace it.">
          <UBadge variant="outline" label="Saved" icon="i-lucide-lock" class="me-1" />
        </UTooltip>
        <span class="sr-only">Stored securely. Type to replace it.</span>
      </template>
      <UTooltip v-if="isStored && !disabled" text="Clear stored secret">
        <UButton
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          aria-label="Clear stored secret"
          @click="clear"
        />
      </UTooltip>
      <UButton
        v-else-if="model"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        size="xs"
        variant="ghost"
        :aria-label="visible ? 'Hide value' : 'Show value'"
        :aria-pressed="visible"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
