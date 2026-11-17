<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import { newSegmentCondition } from '#shared/schemas/segments'
import type { SegmentCondition, SegmentGroup } from '#shared/types/domain'

const props = defineProps<{
  name: string
  prefix: string
  canAdd: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const group = defineModel<SegmentGroup>({ required: true })

const matchItems: SelectItem[] = Object.entries(SEGMENT_GROUP_MATCH_LABELS).map(
  ([value, label]) => ({ label, value })
)

const keyOf = useSegmentNodeKeys()

const container = useTemplateRef<HTMLElement>('container')

async function focusCondition(condition: SegmentCondition | undefined) {
  await nextTick()

  const row = condition
    ? container.value?.querySelector<HTMLElement>(`[data-row-key="${keyOf(condition)}"]`)
    : null

  row?.querySelector<HTMLElement>('button, input')?.focus()
}

async function add() {
  if (props.readonly || !props.canAdd) return

  const condition = newSegmentCondition('email')
  group.value.conditions.push(condition)
  await focusCondition(condition)
}

async function remove(index: number) {
  if (props.readonly) return

  if (group.value.conditions.length === 1) {
    emit('remove')

    return
  }

  group.value.conditions.splice(index, 1)
  await focusCondition(group.value.conditions[index] ?? group.value.conditions[index - 1])
}

const joiner = computed(() => (group.value.match === 'all' ? 'and' : 'or'))

const groupLabel = computed(
  () =>
    `Condition group: ${SEGMENT_GROUP_MATCH_LABELS[group.value.match].toLowerCase()} of the following`
)
</script>

<template>
  <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
    <span class="w-14 shrink-0 text-[13px] text-muted sm:pt-2.5 sm:text-right sm:pr-1">{{
      prefix
    }}</span>

    <section
      ref="container"
      :aria-label="groupLabel"
      class="min-w-0 flex-1 rounded-md bg-elevated/30 ring ring-default"
    >
      <div
        class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-1.5 text-sm text-default"
      >
        <USelect
          v-model="group.match"
          :items="matchItems"
          size="sm"
          aria-label="Match all, any or none of the conditions in this group"
          class="w-22"
          :disabled="readonly"
        />
        <span>of the following</span>
        <div v-if="!readonly" class="ms-auto flex items-center gap-1">
          <UButton
            label="Add condition"
            icon="i-lucide-plus"
            variant="ghost"
            size="sm"
            :disabled="!canAdd"
            @click="add"
          />
          <UTooltip text="Remove group">
            <UButton
              icon="i-lucide-trash-2"
              variant="ghost"
              size="sm"
              aria-label="Remove group"
              @click="emit('remove')"
            />
          </UTooltip>
        </div>
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
          v-for="(condition, index) in group.conditions"
          :key="keyOf(condition)"
          :data-row-key="keyOf(condition)"
          class="px-3 py-2.5"
        >
          <SegmentsSegmentConditionRow
            :model-value="condition"
            :name="`${props.name}.conditions.${index}`"
            :prefix="index === 0 ? 'Where' : joiner"
            :readonly="readonly"
            @remove="remove(index)"
          />
        </li>
      </TransitionGroup>
    </section>
  </div>
</template>
