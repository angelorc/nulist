<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import type { SegmentActivityConditionState } from '#shared/schemas/segments'
import type { SegmentActivityEvent, SegmentActivityScope } from '#shared/types/domain'

const props = defineProps<{
  name: string
  readonly?: boolean
}>()

const condition = defineModel<SegmentActivityConditionState>({ required: true })

const options = injectSegmentBuilderOptions()

const ANY = 'any'

const operatorItems: SelectItem[] = [
  { label: 'has', value: 'has' },
  { label: 'has not', value: 'has_not' }
]

const eventItems: SelectItem[] = SEGMENT_ACTIVITY_EVENTS.map((event) => ({
  label: event.verb,
  value: event.value
}))

const scopeItems: SelectItem[] = SEGMENT_ACTIVITY_SCOPES.map((scope) => ({
  label: scope.label,
  value: scope.value
}))

const timeframeItems: SelectItem[] = [
  { label: 'ever', value: 'ever' },
  { label: 'in the last', value: 'days' }
]

const scope = computed<SegmentActivityScope>({
  get: () => condition.value.scope ?? 'any',
  set: (next) => {
    const target = condition.value
    target.scope = next

    if (next === 'broadcast') target.broadcastId = target.broadcastId ?? null
    else delete target.broadcastId

    if (next === 'transactional') target.templateId = target.templateId ?? null
    else {
      delete target.templateId
      delete target.tag
    }
  }
})

const operator = computed<'has' | 'has_not'>({
  get: () => condition.value.operator,
  set: (next) => {
    const target = condition.value
    target.operator = next

    if (next === 'has') target.times = target.times ?? 1
    else delete target.times
  }
})

const event = computed<SegmentActivityEvent>({
  get: () => condition.value.event,
  set: (next) => {
    const target = condition.value
    target.event = next

    if (next !== 'clicked') delete target.link
  }
})

const connector = computed(() => segmentActivityEventDefinition(condition.value.event).preposition)

const broadcastItems = computed(() => [
  { label: 'Any broadcast', value: ANY },
  ...optionsWithSelected(options.broadcasts.value, condition.value.broadcastId, 'Unknown broadcast')
])

const templateItems = computed(() => [
  { label: 'Any template', value: ANY },
  ...optionsWithSelected(options.templates.value, condition.value.templateId, 'Deleted template')
])

const broadcastId = computed<string>({
  get: () => condition.value.broadcastId || ANY,
  set: (next) => {
    condition.value.broadcastId = next === ANY ? null : next
  }
})

const templateId = computed<string>({
  get: () => condition.value.templateId || ANY,
  set: (next) => {
    condition.value.templateId = next === ANY ? null : next
  }
})

function setTag(key: string, value: string) {
  if (!key && !value) delete condition.value.tag
  else condition.value.tag = { key, value }
}

const tagKey = computed<string>({
  get: () => condition.value.tag?.key ?? '',
  set: (next) => setTag(next, condition.value.tag?.value ?? '')
})

const tagValue = computed<string>({
  get: () => condition.value.tag?.value ?? '',
  set: (next) => setTag(condition.value.tag?.key ?? '', next)
})

const link = computed<string>({
  get: () => condition.value.link ?? '',
  set: (next) => {
    if (next) condition.value.link = next
    else delete condition.value.link
  }
})

const times = computed<string>({
  get: () => String(condition.value.times ?? ''),
  set: (next) => {
    condition.value.times = next
  }
})

const timesLabel = computed(() => (Number(condition.value.times) === 1 ? 'time' : 'times'))

const timeframe = computed<'ever' | 'days'>({
  get: () =>
    condition.value.days === null || condition.value.days === undefined ? 'ever' : 'days',
  set: (next) => {
    condition.value.days = next === 'ever' ? null : 30
  }
})

const days = computed<string>({
  get: () => String(condition.value.days ?? ''),
  set: (next) => {
    condition.value.days = next
  }
})

const connectorClass = 'flex h-8 items-center text-[13px] text-muted'
</script>

<template>
  <UFormField :name="`${props.name}.operator`">
    <USelect
      v-model="operator"
      :items="operatorItems"
      aria-label="Has or has not"
      class="w-26"
      :disabled="readonly"
    />
  </UFormField>

  <UFormField :name="`${props.name}.event`">
    <USelect
      v-model="event"
      :items="eventItems"
      aria-label="Email event"
      class="w-32"
      :disabled="readonly"
    />
  </UFormField>

  <span v-if="connector" :class="connectorClass">{{ connector }}</span>

  <UFormField :name="`${props.name}.scope`">
    <USelect
      v-model="scope"
      :items="scopeItems"
      aria-label="Which emails"
      class="w-48"
      :disabled="readonly"
    />
  </UFormField>

  <UFormField v-if="scope === 'broadcast'" :name="`${props.name}.broadcastId`" class="min-w-0">
    <USelectMenu
      v-model="broadcastId"
      :items="broadcastItems"
      value-key="value"
      :loading="options.broadcasts.value.loading"
      :search-input="{ placeholder: 'Search broadcasts…' }"
      icon="i-lucide-send"
      aria-label="Broadcast"
      class="w-56 max-w-full"
      :disabled="readonly"
    />
  </UFormField>

  <template v-if="scope === 'transactional'">
    <UFormField :name="`${props.name}.templateId`" class="min-w-0">
      <USelectMenu
        v-model="templateId"
        :items="templateItems"
        value-key="value"
        :loading="options.templates.value.loading"
        :search-input="{ placeholder: 'Search templates…' }"
        icon="i-lucide-layout-template"
        aria-label="Transactional template"
        class="w-56 max-w-full"
        :disabled="readonly"
      />
    </UFormField>
    <span :class="connectorClass">tagged</span>
    <UFormField :name="`${props.name}.tag.key`">
      <UInput
        v-model="tagKey"
        placeholder="Any tag"
        aria-label="Tag name"
        class="w-28"
        :ui="{ base: 'font-mono' }"
        :disabled="readonly"
      />
    </UFormField>
    <span :class="connectorClass">=</span>
    <UFormField :name="`${props.name}.tag.value`">
      <UInput
        v-model="tagValue"
        placeholder="Value"
        aria-label="Tag value"
        class="w-28"
        :disabled="readonly"
      />
    </UFormField>
  </template>

  <template v-if="condition.event === 'clicked'">
    <span :class="connectorClass">link contains</span>
    <UFormField :name="`${props.name}.link`">
      <UInput
        v-model="link"
        placeholder="Any link"
        aria-label="Link contains"
        class="w-40"
        :disabled="readonly"
      />
    </UFormField>
  </template>

  <template v-if="operator === 'has'">
    <span :class="connectorClass">at least</span>
    <UFormField :name="`${props.name}.times`">
      <UInput
        v-model="times"
        type="number"
        inputmode="numeric"
        min="1"
        step="1"
        aria-label="Minimum number of times"
        class="w-24"
        :ui="{ base: 'tabular-nums', trailing: 'pointer-events-none' }"
        :disabled="readonly"
      >
        <template #trailing>
          <span class="text-xs text-muted">{{ timesLabel }}</span>
        </template>
      </UInput>
    </UFormField>
  </template>

  <USelect
    v-model="timeframe"
    :items="timeframeItems"
    aria-label="Time window"
    class="w-30"
    :disabled="readonly"
  />

  <UFormField v-if="timeframe === 'days'" :name="`${props.name}.days`">
    <UInput
      v-model="days"
      type="number"
      inputmode="numeric"
      min="1"
      step="1"
      aria-label="Number of days"
      class="w-24"
      :ui="{ base: 'tabular-nums', trailing: 'pointer-events-none' }"
      :disabled="readonly"
    >
      <template #trailing>
        <span class="text-xs text-muted">days</span>
      </template>
    </UInput>
  </UFormField>
</template>
