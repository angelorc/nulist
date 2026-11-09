<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import { defaultSegmentValue, segmentValueKind } from '#shared/schemas/segments'
import type { SegmentCondition, SegmentField, SegmentOperator } from '#shared/types/domain'

export interface ListOption {
  label: string
  value: string
}

const props = defineProps<{
  /** Form path of this condition, e.g. `rules.conditions.2`. */
  name: string
  /** "Where" for the first row, then the match joiner ("and" / "or"). */
  prefix: string
  lists: ListOption[]
  listsLoading?: boolean
  /** Shows the condition without editing controls. */
  readonly?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

/** Mutated in place so the row keeps its identity (and focus) while editing. */
const condition = defineModel<SegmentCondition>({ required: true })

const FIELD_ICONS: Record<SegmentField, string> = {
  email: 'i-lucide-at-sign',
  first_name: 'i-lucide-user',
  last_name: 'i-lucide-user',
  source: 'i-lucide-log-in',
  status: 'i-lucide-circle-dot',
  created_at: 'i-lucide-calendar-plus',
  last_opened_at: 'i-lucide-mail-open',
  last_clicked_at: 'i-lucide-mouse-pointer-click',
  list: 'i-lucide-list',
  engagement: 'i-lucide-activity',
  attribute: 'i-lucide-braces'
}

const FIELD_GROUPS: SegmentField[][] = [
  ['email', 'first_name', 'last_name', 'source', 'status'],
  ['created_at', 'last_opened_at', 'last_clicked_at'],
  ['list', 'engagement'],
  ['attribute']
]

const fieldItems: SelectItem[][] = FIELD_GROUPS.map((group) =>
  group.map((field) => {
    const definition = segmentFieldDefinition(field)

    return { label: definition.label, value: field, icon: FIELD_ICONS[field] }
  })
)

const definition = computed(() => segmentFieldDefinition(condition.value.field))
const kind = computed(() => segmentValueKind(condition.value.field, condition.value.operator))

const operatorItems = computed<SelectItem[]>(() =>
  definition.value.operators.map((operator) => ({
    label: SEGMENT_OPERATOR_LABELS[operator].replace(' (days)', ''),
    value: operator
  }))
)

const optionItems = computed<SelectItem[]>(() =>
  (definition.value.options ?? []).map((o) => ({
    label: o.label.charAt(0).toUpperCase() + o.label.slice(1),
    value: o.value
  }))
)

const field = computed<SegmentField>({
  get: () => condition.value.field,
  set: (next) => {
    if (next === condition.value.field) return
    const target = condition.value
    const operator = segmentFieldDefinition(next).operators[0]!
    target.field = next
    target.operator = operator
    target.value = initialValue(next, operator)

    if (next === 'attribute') target.key = target.key ?? ''
    else delete target.key
  }
})

const operator = computed<SegmentOperator>({
  get: () => condition.value.operator,
  set: (next) => {
    const target = condition.value
    const previousKind = kind.value
    target.operator = next

    if (segmentValueKind(target.field, next) !== previousKind)
      target.value = initialValue(target.field, next)
  }
})

function initialValue(fieldName: SegmentField, op: SegmentOperator) {
  const valueKind = segmentValueKind(fieldName, op)

  if (valueKind === 'list') return props.lists[0]?.value ?? null

  return defaultSegmentValue(valueKind, fieldName)
}

const text = computed<string>({
  get: () =>
    condition.value.value === null || condition.value.value === undefined
      ? ''
      : String(condition.value.value),
  set: (next) => {
    condition.value.value = next
  }
})

const key = computed<string>({
  get: () => condition.value.key ?? '',
  set: (next) => {
    condition.value.key = next
  }
})

const listValue = computed<string | undefined>({
  get: () => (condition.value.value ? String(condition.value.value) : undefined),
  set: (next) => {
    condition.value.value = next ?? null
  }
})
</script>

<template>
  <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
    <span class="w-14 shrink-0 text-[13px] text-muted sm:pt-1.5 sm:text-right sm:pr-1">{{
      prefix
    }}</span>

    <div class="flex min-w-0 flex-1 flex-wrap items-start gap-2">
      <UFormField :name="`${name}.field`" class="w-full sm:w-44">
        <USelect
          v-model="field"
          :items="fieldItems"
          :icon="FIELD_ICONS[condition.field]"
          aria-label="Property"
          class="w-full"
          :disabled="readonly"
        />
      </UFormField>

      <UFormField
        v-if="condition.field === 'attribute'"
        :name="`${name}.key`"
        class="w-full sm:w-36"
      >
        <UInput
          v-model="key"
          placeholder="Attribute key"
          aria-label="Attribute key"
          class="w-full"
          :ui="{ base: 'font-mono' }"
          :disabled="readonly"
        />
      </UFormField>

      <UFormField :name="`${name}.operator`" class="w-full sm:w-52">
        <USelect
          v-model="operator"
          :items="operatorItems"
          aria-label="Operator"
          class="w-full"
          :disabled="readonly"
        />
      </UFormField>

      <UFormField v-if="kind !== 'none'" :name="`${name}.value`" class="w-full min-w-40 flex-1">
        <USelect
          v-if="kind === 'option'"
          v-model="text"
          :items="optionItems"
          aria-label="Value"
          class="w-full"
          :disabled="readonly"
        />
        <USelectMenu
          v-else-if="kind === 'list'"
          v-model="listValue"
          :items="lists"
          value-key="value"
          :loading="listsLoading"
          :placeholder="lists.length || listsLoading ? 'Select a list' : 'No lists yet'"
          :search-input="{ placeholder: 'Search lists…' }"
          icon="i-lucide-list"
          aria-label="List"
          class="w-full"
          :disabled="readonly"
        />
        <UInput
          v-else-if="kind === 'days'"
          v-model="text"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          aria-label="Number of days"
          class="w-full"
          :disabled="readonly"
          :ui="{ trailing: 'pointer-events-none' }"
        >
          <template #trailing>
            <span class="text-xs text-muted">days</span>
          </template>
        </UInput>
        <UInput
          v-else-if="kind === 'date'"
          v-model="text"
          type="date"
          aria-label="Date"
          class="w-full"
          :disabled="readonly"
        />
        <UInput
          v-else-if="kind === 'number'"
          v-model="text"
          type="number"
          step="any"
          inputmode="decimal"
          placeholder="0"
          aria-label="Number"
          class="w-full"
          :ui="{ base: 'tabular-nums' }"
          :disabled="readonly"
        />
        <UInput
          v-else
          v-model="text"
          placeholder="Value"
          aria-label="Value"
          class="w-full"
          :disabled="readonly"
        />
      </UFormField>
      <div v-else class="hidden flex-1 sm:block" />
    </div>

    <UButton
      v-if="!readonly"
      icon="i-lucide-x"
      variant="ghost"
      aria-label="Remove condition"
      class="self-end sm:self-start"
      @click="emit('remove')"
    />
  </div>
</template>
