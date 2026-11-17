<script setup lang="ts">
import {
  MAX_SEGMENT_CONDITIONS,
  MAX_SEGMENT_GROUPS,
  isSegmentGroup,
  newSegmentCondition,
  newSegmentGroup,
  segmentConditionEntries
} from '#shared/schemas/segments'
import type { SegmentNode, SegmentRules } from '#shared/types/domain'

/**
 * "Match [all ▾] of the following" + one row per condition or condition group.
 * Reusable: bind any SegmentRules object; `name` is the form path used for field errors.
 * `readonly` disables every control and hides adding and removing conditions.
 */
const props = withDefaults(
  defineProps<{ name?: string; readonly?: boolean; segmentId?: string }>(),
  {
    name: 'rules',
    readonly: false,
    segmentId: undefined
  }
)

const rules = defineModel<SegmentRules>({ required: true })

provide(
  SEGMENT_BUILDER_OPTIONS,
  useSegmentBuilderOptions(() => props.segmentId)
)

const matchItems = [
  { label: 'all', value: 'all' },
  { label: 'any', value: 'any' }
]

const keyOf = useSegmentNodeKeys()

const container = useTemplateRef<HTMLElement>('container')

const conditionCount = computed(() => segmentConditionEntries(rules.value).length)
const groupCount = computed(() => rules.value.conditions.filter(isSegmentGroup).length)
const canAdd = computed(() => conditionCount.value < MAX_SEGMENT_CONDITIONS)
const canAddGroup = computed(() => canAdd.value && groupCount.value < MAX_SEGMENT_GROUPS)

const limitNote = computed(() => {
  if (!canAdd.value) return `Up to ${MAX_SEGMENT_CONDITIONS} conditions`

  if (!canAddGroup.value) return `Up to ${MAX_SEGMENT_GROUPS} groups`

  return null
})

async function focusNode(node: SegmentNode | undefined) {
  await nextTick()

  const target = node
    ? container.value
        ?.querySelector<HTMLElement>(`[data-node-key="${keyOf(node)}"]`)
        ?.querySelector<HTMLElement>('button, input')
    : container.value?.querySelector<HTMLElement>('[data-add-condition]')

  target?.focus()
}

async function add() {
  if (props.readonly || !canAdd.value) return

  const condition = newSegmentCondition('email')
  rules.value.conditions.push(condition)
  await focusNode(condition)
}

async function addGroup() {
  if (props.readonly || !canAddGroup.value) return

  const group = newSegmentGroup()
  rules.value.conditions.push(group)
  await focusNode(group)
}

async function remove(index: number) {
  if (props.readonly) return

  rules.value.conditions.splice(index, 1)
  await focusNode(rules.value.conditions[index] ?? rules.value.conditions[index - 1])
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
        v-for="(node, index) in rules.conditions"
        :key="keyOf(node)"
        :data-node-key="keyOf(node)"
        class="px-3 py-2.5"
      >
        <SegmentsSegmentGroupBlock
          v-if="isSegmentGroup(node)"
          :model-value="node"
          :name="`${props.name}.conditions.${index}`"
          :prefix="index === 0 ? 'Where' : joiner"
          :can-add="canAdd"
          :readonly="readonly"
          @remove="remove(index)"
        />
        <SegmentsSegmentConditionRow
          v-else
          :model-value="node"
          :name="`${props.name}.conditions.${index}`"
          :prefix="index === 0 ? 'Where' : joiner"
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
      class="flex flex-wrap items-center gap-1 border-t border-default px-2 py-1.5"
    >
      <UButton
        label="Add condition"
        icon="i-lucide-plus"
        variant="ghost"
        size="sm"
        data-add-condition
        :disabled="!canAdd"
        @click="add"
      />
      <UButton
        label="Add group"
        icon="i-lucide-brackets"
        variant="ghost"
        size="sm"
        :disabled="!canAddGroup"
        @click="addGroup"
      />
      <span v-if="limitNote" class="ms-auto pr-2 text-xs text-muted">{{ limitNote }}</span>
    </div>
  </div>
</template>
