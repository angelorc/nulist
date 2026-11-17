<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { newSegmentCondition } from '#shared/schemas/segments'
import type { SegmentInput } from '#shared/schemas/segments'
import type { SegmentPreset } from '#shared/utils/segments'
import type { SegmentFormState } from '~/components/segments/SegmentForm.vue'

definePageMeta({ permission: { segment: ['create'] } })

useSeoMeta({ title: 'New segment' })

const confirm = useConfirm()
const form = useTemplateRef('form')

const state = ref<SegmentFormState>({
  name: '',
  description: '',
  rules: { match: 'all', conditions: [newSegmentCondition('email')] }
})

const baseline = JSON.stringify(state.value)
const dirty = computed(() => JSON.stringify(state.value) !== baseline)
const applied = ref<{ preset: SegmentPreset; state: string } | null>(null)
let saved = false

async function applyPreset(preset: SegmentPreset) {
  const current = JSON.stringify(state.value)
  const pristine = current === baseline || current === applied.value?.state

  if (!pristine) {
    const ok = await confirm({
      title: `Start from "${preset.label}"?`,
      description: 'Your current conditions will be replaced.',
      confirmLabel: 'Replace conditions'
    })

    if (!ok) return
  }

  const previous = applied.value?.preset
  const next = state.value

  if (!next.name.trim() || next.name === previous?.label) next.name = preset.label

  if (!next.description.trim() || next.description === previous?.description)
    next.description = preset.description

  next.rules = structuredClone(preset.rules)
  applied.value = { preset, state: JSON.stringify(next) }
}

const presetItems: DropdownMenuItem[] = SEGMENT_PRESETS.map((preset) => ({
  label: preset.label,
  description: preset.description,
  icon: preset.icon,
  onSelect: () => applyPreset(preset)
}))

const { run, pending } = useApiAction(
  (data: SegmentInput) => $fetch<{ id: string }>('/api/segments', { method: 'POST', body: data }),
  { success: 'Segment created', error: "Couldn't create the segment" }
)

async function save(data: SegmentInput) {
  const created = await run(data)

  if (!created) return
  saved = true
  await navigateTo(`/segments/${created.id}`, { replace: true })
}

onBeforeRouteLeave(async () => {
  if (saved || !dirty.value) return true

  return confirm({
    title: 'Discard this segment?',
    description: 'Your conditions have not been saved.',
    confirmLabel: 'Discard',
    danger: true
  })
})

useEventListener(
  import.meta.client ? window : undefined,
  'beforeunload',
  (event: BeforeUnloadEvent) => {
    if (dirty.value && !saved) event.preventDefault()
  }
)

defineShortcuts({ meta_s: { usingInput: true, handler: () => form.value?.submit() } })
</script>

<template>
  <UDashboardPanel id="segment-new">
    <template #header>
      <UDashboardNavbar title="New segment">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/segments"
            aria-label="Back to segments"
          />
        </template>
        <template #right>
          <UDropdownMenu :items="presetItems" :content="{ align: 'end' }" :ui="{ content: 'w-80' }">
            <UButton label="Start from a preset" icon="i-lucide-library" variant="ghost" />
          </UDropdownMenu>
          <UButton label="Cancel" variant="ghost" to="/segments" class="hidden sm:inline-flex" />
          <UTooltip text="Create segment" :kbds="['meta', 's']">
            <UButton type="submit" form="segment-form" label="Create segment" :loading="pending" />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full max-w-6xl">
        <SegmentsSegmentForm id="segment-form" ref="form" v-model:state="state" @submit="save" />
      </div>
    </template>
  </UDashboardPanel>
</template>
