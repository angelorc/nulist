<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    id: string
    active: number
    title?: string
  }>(),
  { title: 'Filters' }
)

const emit = defineEmits<{ clear: [] }>()

const open = defineModel<boolean>('open', { default: false })

const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')

watch(isDesktop, (desktop) => {
  if (desktop) {
    open.value = false
  }
})

const panelBody = useTemplateRef<HTMLElement>('panelBody')

const slideoverBody = useTemplateRef<HTMLElement>('slideoverBody')

const searchOnEnter = ref(false)

const searchInput = (root: HTMLElement | null) => root?.querySelector('input') ?? null

function focusSearch() {
  if (isDesktop.value) {
    searchInput(panelBody.value)?.focus()

    return
  }

  if (open.value) {
    searchInput(slideoverBody.value)?.focus()

    return
  }

  searchOnEnter.value = true
  open.value = true
}

function onEntered() {
  if (!searchOnEnter.value) return

  searchOnEnter.value = false
  searchInput(slideoverBody.value)?.focus()
}

defineShortcuts({ '/': focusSearch })
</script>

<template>
  <UDashboardPanel
    :id="id"
    v-bind="$attrs"
    resizable
    :default-size="18"
    :min-size="14"
    :max-size="26"
    class="hidden lg:flex"
    :ui="{ body: 'gap-2 p-3 sm:gap-2 sm:p-3' }"
  >
    <template #header>
      <UDashboardNavbar :title="title" :toggle="false">
        <template #right>
          <UButton
            v-if="active > 0"
            label="Clear all"
            color="neutral"
            variant="ghost"
            size="sm"
            class="text-muted"
            @click="emit('clear')"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div ref="panelBody" class="contents">
        <slot />
      </div>
    </template>
  </UDashboardPanel>

  <USlideover
    v-model:open="open"
    side="left"
    :title="title"
    :ui="{ content: 'max-w-xs sm:max-w-sm', body: 'flex flex-col gap-2 p-3 sm:p-3' }"
    @after:enter="onEntered"
  >
    <template #body>
      <div ref="slideoverBody" class="contents">
        <slot />
      </div>
    </template>

    <template #footer>
      <UButton
        v-if="active > 0"
        label="Clear all"
        color="neutral"
        variant="ghost"
        @click="emit('clear')"
      />
      <UButton label="Show results" color="neutral" variant="solid" @click="open = false" />
    </template>
  </USlideover>
</template>
