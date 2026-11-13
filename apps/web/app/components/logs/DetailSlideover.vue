<script setup lang="ts">
/**
 * Detail slideover shared by every log view. The open state lives in the URL
 * (`?id=`, bound through `v-model:id`), so a detail can be linked to and the
 * list behind stays in context. `ids` (the visible rows, in order) enables
 * previous/next navigation with the buttons or J / K.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    ids?: string[]
    wide?: boolean
  }>(),
  { title: '', ids: () => [], wide: false }
)

const id = defineModel<string | undefined>('id')

const mounted = useMounted()
const open = computed(() => mounted.value && !!id.value)
const index = computed(() => (id.value ? props.ids.indexOf(id.value) : -1))
const prevId = computed(() => (index.value > 0 ? props.ids[index.value - 1] : undefined))

const nextId = computed(() =>
  index.value >= 0 && index.value < props.ids.length - 1 ? props.ids[index.value + 1] : undefined
)

function go(target: string | undefined) {
  if (target) id.value = target
}

const nestedOverlays = provideNestedOverlays()

const navigable = computed(() => open.value && nestedOverlays.value === 0)

defineShortcuts({
  j: () => navigable.value && go(nextId.value),
  k: () => navigable.value && go(prevId.value)
})
</script>

<template>
  <USlideover
    :open="open"
    :title="title"
    :ui="{
      content: wide ? 'sm:max-w-[720px]' : 'sm:max-w-xl',
      header: 'items-start pe-14 sm:pe-16',
      wrapper: 'min-w-0 flex-1',
      title: 'truncate',
      description: 'flex flex-wrap items-center gap-x-2 gap-y-1'
    }"
    @update:open="
      (value: boolean) => {
        if (!value) id = undefined
      }
    "
  >
    <template #title>
      <slot name="title">
        {{ title }}
      </slot>
    </template>

    <template v-if="$slots.meta" #description>
      <slot name="meta" />
    </template>

    <template #actions>
      <div v-if="ids.length > 1 && index >= 0" class="flex items-center gap-0.5 shrink-0">
        <UTooltip text="Previous" :kbds="['k']">
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Previous"
            :disabled="!prevId"
            @click="go(prevId)"
          />
        </UTooltip>
        <UTooltip text="Next" :kbds="['j']">
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Next"
            :disabled="!nextId"
            @click="go(nextId)"
          />
        </UTooltip>
      </div>
    </template>

    <template #body>
      <slot />
    </template>
  </USlideover>
</template>
