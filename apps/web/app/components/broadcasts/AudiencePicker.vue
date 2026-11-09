<script setup lang="ts">
import type {
  AudienceListOption,
  AudienceSegmentOption,
  BroadcastEstimate
} from '#shared/types/broadcasts'
import type { AudienceDefinition } from '#shared/types/domain'

/**
 * "To" field of the composer: lists and segments as removable chips, an optional
 * "Except" row for excluded lists and a live, debounced recipient estimate.
 */
const props = defineProps<{
  lists: AudienceListOption[]
  segments: AudienceSegmentOption[]
  topicId: string | null
  loading?: boolean
  disabled?: boolean
}>()

const audience = defineModel<AudienceDefinition>({ required: true })

const { number } = useFormat()

interface SourceItem {
  type?: 'label'
  label: string
  value?: string
  icon?: string
  count: number | null
}

const listItems = computed<SourceItem[]>(() =>
  props.lists.map((l) => ({
    label: l.name,
    value: `list:${l.id}`,
    icon: 'i-lucide-list',
    count: l.confirmedCount
  }))
)

const segmentItems = computed<SourceItem[]>(() =>
  props.segments.map((s) => ({
    label: s.name,
    value: `segment:${s.id}`,
    icon: 'i-lucide-filter',
    count: s.contactCount
  }))
)

const sourceItems = computed<SourceItem[]>(() => [
  ...(listItems.value.length
    ? [{ type: 'label' as const, label: 'Lists', count: null }, ...listItems.value]
    : []),
  ...(segmentItems.value.length
    ? [{ type: 'label' as const, label: 'Segments', count: null }, ...segmentItems.value]
    : [])
])

const excludeItems = computed<SourceItem[]>(() =>
  props.lists.map((l) => ({
    label: l.name,
    value: l.id,
    icon: 'i-lucide-list-x',
    count: l.confirmedCount
  }))
)

const selectedKeys = computed<string[]>({
  get: () => [
    ...audience.value.listIds.map((id) => `list:${id}`),
    ...audience.value.segmentIds.map((id) => `segment:${id}`)
  ],
  set: (keys) => {
    audience.value = {
      ...audience.value,
      listIds: keys.filter((k) => k.startsWith('list:')).map((k) => k.slice(5)),
      segmentIds: keys.filter((k) => k.startsWith('segment:')).map((k) => k.slice(8))
    }
  }
})

const excluded = computed<string[]>({
  get: () => audience.value.excludeListIds,
  set: (ids) => {
    audience.value = { ...audience.value, excludeListIds: ids }
  }
})

const chips = computed(() => [
  ...audience.value.listIds.map((id) => {
    const list = props.lists.find((l) => l.id === id)

    return {
      key: `list:${id}`,
      icon: 'i-lucide-list',
      label: list?.name ?? (props.loading ? 'Loading…' : 'Deleted list'),
      count: list?.confirmedCount ?? null
    }
  }),
  ...audience.value.segmentIds.map((id) => {
    const segment = props.segments.find((s) => s.id === id)

    return {
      key: `segment:${id}`,
      icon: 'i-lucide-filter',
      label: segment?.name ?? (props.loading ? 'Loading…' : 'Deleted segment'),
      count: segment?.contactCount ?? null
    }
  })
])

const excludedChips = computed(() =>
  audience.value.excludeListIds.map((id) => {
    const list = props.lists.find((l) => l.id === id)

    return { key: id, label: list?.name ?? (props.loading ? 'Loading…' : 'Deleted list') }
  })
)

const showExclude = ref(audience.value.excludeListIds.length > 0)

/** Audience chips: 28px tall, 13px text, room for the remove button. */
const chipUi = computed(() => ({
  base: `h-7 font-normal text-[13px] text-default ${props.disabled ? 'pe-2' : 'pe-1'}`,
  icon: 'size-3.5 text-muted'
}))

function removeSource(key: string) {
  selectedKeys.value = selectedKeys.value.filter((k) => k !== key)
}

function removeExcluded(id: string) {
  excluded.value = excluded.value.filter((e) => e !== id)
}

// Live estimate ---------------------------------------------------------------
const estimate = ref<number | null>(null)
const estimating = ref(false)
const estimateFailed = ref(false)
let requestId = 0

const signature = computed(() => JSON.stringify([audience.value, props.topicId]))

const hasSources = computed(
  () => audience.value.listIds.length + audience.value.segmentIds.length > 0
)

async function loadEstimate() {
  const current = ++requestId

  if (!hasSources.value) {
    estimate.value = 0
    estimating.value = false

    return
  }

  estimating.value = true
  estimateFailed.value = false

  try {
    const result = await $fetch<BroadcastEstimate>('/api/broadcasts/estimate', {
      method: 'POST',
      body: { audience: audience.value, topicId: props.topicId }
    })

    if (current === requestId) estimate.value = result.count
  } catch {
    if (current === requestId) estimateFailed.value = true
  } finally {
    if (current === requestId) estimating.value = false
  }
}

const debouncedEstimate = useDebounceFn(loadEstimate, 400)

watch(signature, () => {
  requestId++
  estimating.value = hasSources.value
  void debouncedEstimate()
})

onMounted(loadEstimate)
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-1.5 min-h-8">
      <UBadge
        v-for="chip in chips"
        :key="chip.key"
        :icon="chip.icon"
        size="lg"
        class="max-w-full"
        :ui="{ base: chipUi.base, leadingIcon: chipUi.icon }"
      >
        <span class="truncate text-highlighted">{{ chip.label }}</span>
        <span v-if="chip.count !== null" class="text-muted tabular-nums">{{
          number(chip.count)
        }}</span>
        <template v-if="!disabled" #trailing>
          <UButton
            icon="i-lucide-x"
            size="xs"
            variant="ghost"
            class="-me-1"
            :aria-label="`Remove ${chip.label}`"
            @click="removeSource(chip.key)"
          />
        </template>
      </UBadge>

      <USelectMenu
        v-if="!disabled"
        v-model="selectedKeys"
        :items="sourceItems"
        value-key="value"
        multiple
        icon="i-lucide-plus"
        variant="ghost"
        size="sm"
        :loading="loading"
        :search-input="{ placeholder: 'Search lists and segments…', icon: 'i-lucide-search' }"
        :content="{ align: 'start' }"
        :ui="{ base: 'w-auto text-muted', content: 'min-w-72' }"
        aria-label="Add lists or segments"
      >
        <span>{{ chips.length ? 'Add' : 'Choose lists or segments' }}</span>
        <template #item-trailing="{ item }">
          <span v-if="item.count !== null" class="text-xs text-muted tabular-nums">
            {{ number(item.count) }}
          </span>
        </template>
        <template #empty>
          <span class="text-[13px] text-muted">No lists or segments yet.</span>
        </template>
      </USelectMenu>

      <UButton
        v-if="!disabled && !showExclude && lists.length"
        label="Exclude lists"
        icon="i-lucide-list-x"
        size="sm"
        variant="ghost"
        class="text-muted"
        @click="showExclude = true"
      />
    </div>

    <div v-if="showExclude || excludedChips.length" class="flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted me-1">Except members of</span>
      <UBadge
        v-for="chip in excludedChips"
        :key="chip.key"
        icon="i-lucide-list-x"
        variant="outline"
        size="lg"
        class="max-w-full"
        :ui="{ base: chipUi.base, leadingIcon: chipUi.icon }"
      >
        <span class="truncate">{{ chip.label }}</span>
        <template v-if="!disabled" #trailing>
          <UButton
            icon="i-lucide-x"
            size="xs"
            variant="ghost"
            class="-me-1"
            :aria-label="`Stop excluding ${chip.label}`"
            @click="removeExcluded(chip.key)"
          />
        </template>
      </UBadge>
      <USelectMenu
        v-if="!disabled"
        v-model="excluded"
        :items="excludeItems"
        value-key="value"
        multiple
        icon="i-lucide-plus"
        variant="ghost"
        size="sm"
        :search-input="{ placeholder: 'Search lists…', icon: 'i-lucide-search' }"
        :content="{ align: 'start' }"
        :ui="{ base: 'w-auto text-muted', content: 'min-w-64' }"
        aria-label="Exclude lists"
      >
        <span>{{ excludedChips.length ? 'Add' : 'Choose lists' }}</span>
      </USelectMenu>
    </div>

    <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <UIcon
        v-if="estimating"
        name="i-lucide-loader-circle"
        class="size-3.5 animate-spin"
        aria-hidden="true"
      />
      <UIcon v-else name="i-lucide-users" class="size-3.5" aria-hidden="true" />
      <template v-if="!hasSources"> Choose who receives this broadcast. </template>
      <template v-else-if="estimateFailed">
        Couldn't estimate recipients.
        <UButton
          label="Retry"
          variant="link"
          color="primary"
          size="xs"
          class="p-0"
          @click="loadEstimate"
        />
      </template>
      <template v-else-if="estimate === null"> Counting recipients… </template>
      <span v-else :class="estimating && 'opacity-60'">
        <span class="font-medium text-highlighted tabular-nums">≈ {{ number(estimate) }}</span>
        {{ estimate === 1 ? 'recipient' : 'recipients' }} · active, subscribed and not suppressed
      </span>
    </p>
  </div>
</template>
