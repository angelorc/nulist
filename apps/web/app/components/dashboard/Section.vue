<script setup lang="ts">
import type { VNode } from 'vue'

/**
 * A titled card section of a dashboard-style page (UCard): title and muted description on the
 * left, `#actions` on the right, content below. `flush` removes the body padding for tables and
 * lists that run edge to edge (they draw their own top border).
 *
 * <DashboardSection title="Top links" description="Unique clicks per link" flush>…</DashboardSection>
 */
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    /** Remove body padding (tables, lists that run edge to edge). */
    flush?: boolean
  }>(),
  { description: undefined, flush: false }
)

const slots = defineSlots<{ default?: () => VNode[]; actions?: () => VNode[] }>()

const titleId = useId()

const ui = computed(() => ({
  root: 'flex flex-col min-w-0 divide-y-0',
  header: [
    'flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-4',
    props.flush ? 'pb-3' : 'pb-0'
  ],
  body: ['flex-1 min-w-0', props.flush ? 'p-0 sm:p-0' : 'p-4 sm:p-4']
}))
</script>

<template>
  <UCard as="section" :aria-labelledby="titleId" :ui="ui">
    <template #header>
      <div class="min-w-0">
        <h2 :id="titleId" class="text-base font-semibold text-highlighted">
          {{ title }}
        </h2>
        <p v-if="description" class="text-[13px] text-muted mt-0.5">
          {{ description }}
        </p>
      </div>
      <div v-if="slots.actions" class="flex items-center gap-2 min-w-0 max-w-full">
        <slot name="actions" />
      </div>
    </template>

    <slot />
  </UCard>
</template>
