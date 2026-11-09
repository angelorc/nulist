<script setup lang="ts">
import { MAX_SEGMENT_CONDITIONS, newSegmentCondition } from '#shared/schemas/segments'
import type { SegmentCondition, SegmentRules } from '#shared/types/domain'
import type { ListOption } from './SegmentConditionRow.vue'

/**
 * "Match [all ▾] of the following" + one row per condition.
 * Reusable: bind any SegmentRules object; `name` is the form path used for field errors.
 * `readonly` disables every control and hides adding and removing conditions.
 */
const props = withDefaults(defineProps<{ name?: string; readonly?: boolean }>(), {
  name: 'rules',
  readonly: false
})

const rules = defineModel<SegmentRules>({ required: true })

interface ListSummary {
  id: string
  name: string
}

// Lists of the active organization (list:read is granted to every role).
const { data: listData, status: listStatus } = useFetch<ListSummary[]>('/api/lists', {
  key: 'segment-builder-lists',
  lazy: true,
  default: () => []
})

const lists = computed<ListOption[]>(() =>
  (listData.value ?? []).map((l) => ({ label: l.name, value: l.id }))
)

const matchItems = [
  { label: 'all', value: 'all' },
  { label: 'any', value: 'any' }
]

// Stable row keys without polluting the rules JSON.
const keys = new WeakMap<SegmentCondition, number>()
let seq = 0

function keyOf(condition: SegmentCondition): number {
  const raw = toRaw(condition)
  const known = keys.get(raw)

  if (known !== undefined) return known

  seq += 1
  keys.set(raw, seq)

  return seq
}

const container = useTemplateRef<HTMLElement>('container')
const canAdd = computed(() => rules.value.conditions.length < MAX_SEGMENT_CONDITIONS)

async function add() {
  if (props.readonly || !canAdd.value) return
  rules.value.conditions.push(newSegmentCondition('email'))
  await nextTick()
  const rows = container.value?.querySelectorAll<HTMLElement>('[data-condition-row]')
  rows?.[rows.length - 1]?.querySelector<HTMLElement>('button, input')?.focus()
}

function remove(index: number) {
  if (props.readonly) return
  rules.value.conditions.splice(index, 1)
}

const joiner = computed(() => (rules.value.match === 'any' ? 'or' : 'and'))
</script>

<template>
  <div ref="container" class="rounded-lg ring ring-default">
    <div
      class="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-default bg-elevated/40 px-3 py-2 text-sm text-default"
    >
      <span>Match</span>
      <USelect
        v-model="rules.match"
        :items="matchItems"
        size="sm"
        aria-label="Match all or any condition"
        class="w-20"
        :disabled="readonly"
      />
      <span>of the following conditions</span>
    </div>

    <TransitionGroup
      tag="ul"
      class="divide-y divide-default"
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <li
        v-for="(condition, index) in rules.conditions"
        :key="keyOf(condition)"
        class="px-3 py-2.5"
        data-condition-row
      >
        <SegmentsSegmentConditionRow
          :model-value="condition"
          :name="`${props.name}.conditions.${index}`"
          :prefix="index === 0 ? 'Where' : joiner"
          :lists="lists"
          :lists-loading="listStatus === 'pending'"
          :readonly="readonly"
          @remove="remove(index)"
        />
      </li>
    </TransitionGroup>

    <EmptyState
      v-if="!rules.conditions.length"
      icon="i-lucide-list-filter"
      title="No conditions"
      description="This segment matches every contact."
      compact
    />

    <div
      v-if="!readonly"
      class="flex items-center justify-between gap-2 border-t border-default px-2 py-1.5"
    >
      <UButton
        label="Add condition"
        icon="i-lucide-plus"
        variant="ghost"
        size="sm"
        :disabled="!canAdd"
        @click="add"
      />
      <span v-if="!canAdd" class="pr-2 text-xs text-muted"
        >Up to {{ MAX_SEGMENT_CONDITIONS }} conditions</span
      >
    </div>
  </div>
</template>
