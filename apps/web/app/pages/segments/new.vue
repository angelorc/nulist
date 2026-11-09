<script setup lang="ts">
import { newSegmentCondition } from '#shared/schemas/segments'
import type { SegmentInput } from '#shared/schemas/segments'
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
let saved = false

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
