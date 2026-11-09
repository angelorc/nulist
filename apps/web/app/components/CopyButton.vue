<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

/**
 * Icon button that copies `value` to the clipboard, swaps to a check for 1.5s and announces
 * "Copied" to screen readers. Building block of CopyText, CodeBlock and JsonBlock.
 *
 * <CopyButton :value="apiKey" label="API key" />
 */
const props = withDefaults(
  defineProps<{
    value: string
    /** What is copied, for the accessible name ("Copy API key"). */
    label?: string
    size?: ButtonProps['size']
    variant?: ButtonProps['variant']
  }>(),
  { label: '', size: 'xs', variant: 'ghost' }
)

const emit = defineEmits<{ copied: [value: string] }>()

const { copy, copied } = useClipboard({ copiedDuring: 1500, legacy: true })

const accessibleName = computed(() => (props.label ? `Copy ${props.label}` : 'Copy'))

async function onClick() {
  await copy(props.value)
  emit('copied', props.value)
}
</script>

<template>
  <span class="inline-flex">
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      color="neutral"
      :variant="variant"
      :size="size"
      :aria-label="accessibleName"
      @click.stop="onClick"
    />
    <span class="sr-only" aria-live="polite">{{ copied ? 'Copied' : '' }}</span>
  </span>
</template>
