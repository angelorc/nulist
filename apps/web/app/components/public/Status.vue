<script setup lang="ts">
import { unrefElement } from '@vueuse/core'
import type { VNode } from 'vue'

/** What the outcome means; it colors the icon only (DESIGN.md §1: color carries meaning). */
type PublicStatusTone = 'success' | 'warning' | 'error' | 'neutral'

/**
 * Outcome of a recipient page (subscribed, already confirmed, expired or invalid link…) as
 * the page's heading, built on UEmpty. Actions go in the default slot and stack full width on
 * phones; `footer` holds a muted note. With `autofocus` the block takes focus when it appears,
 * so screen readers announce the new state after a form or button replaced it.
 *
 * <PublicStatus icon="i-lucide-circle-check" tone="success" title="You're subscribed" autofocus>
 *   <UButton label="Manage preferences" to="…" />
 * </PublicStatus>
 */
const props = withDefaults(
  defineProps<{
    icon: string
    title: string
    description?: string
    tone?: PublicStatusTone
    autofocus?: boolean
  }>(),
  { description: undefined, tone: 'neutral', autofocus: false }
)

const slots = defineSlots<{
  default?: () => VNode[]
  description?: () => VNode[]
  footer?: () => VNode[]
}>()

const TONE_ICON_CLASS: Record<PublicStatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-muted'
}

const avatar = computed(() => ({ ui: { icon: TONE_ICON_CLASS[props.tone] } }))

const root = useTemplateRef('root')

onMounted(() => {
  if (props.autofocus) unrefElement(root)?.focus()
})
</script>

<template>
  <UEmpty
    ref="root"
    :as="{ root: 'div', title: 'h1' }"
    :icon
    :avatar
    :title
    :description
    size="md"
    role="status"
    tabindex="-1"
    :ui="{
      root: 'gap-5 px-0 py-2 sm:px-0 sm:py-2 lg:px-0 lg:py-2 focus:outline-none',
      title: 'text-lg font-semibold',
      description: 'text-pretty',
      body: 'w-full sm:w-auto',
      actions: 'w-full flex-col sm:w-auto sm:flex-row [&>*]:justify-center',
      footer: 'text-xs text-muted text-pretty text-center'
    }"
  >
    <template v-if="slots.description" #description>
      <slot name="description" />
    </template>

    <template v-if="slots.default" #actions>
      <slot />
    </template>

    <template v-if="slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UEmpty>
</template>
