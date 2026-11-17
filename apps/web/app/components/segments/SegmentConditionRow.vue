<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import {
  defaultSegmentValue,
  newSegmentCondition,
  segmentValueKind
} from '#shared/schemas/segments'
import type { SegmentConditionState, SegmentValueKind } from '#shared/schemas/segments'
import type { SegmentField, SegmentOperator } from '#shared/types/domain'
import type { SegmentBuilderOptionSet } from '~/composables/useSegmentBuilderOptions'

defineProps<{
  /** Form path of this condition, e.g. `rules.conditions.2`. */
  name: string
  /** "Where" for the first row, then the match joiner ("and" / "or"). */
  prefix: string
  /** Shows the condition without editing controls. */
  readonly?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

/** Mutated in place so the row keeps its identity (and focus) while editing. */
const condition = defineModel<SegmentConditionState>({ required: true })

const options = injectSegmentBuilderOptions()

const FIELD_ICONS: Record<SegmentField, string> = {
  email: 'i-lucide-at-sign',
  first_name: 'i-lucide-user',
  last_name: 'i-lucide-user',
  source: 'i-lucide-log-in',
  status: 'i-lucide-circle-dot',
  created_at: 'i-lucide-calendar-plus',
  last_opened_at: 'i-lucide-mail-open',
  last_clicked_at: 'i-lucide-mouse-pointer-click',
  activity: 'i-lucide-mails',
  engagement: 'i-lucide-activity',
  list: 'i-lucide-list',
  segment: 'i-lucide-filter',
  topic: 'i-lucide-bell',
  attribute: 'i-lucide-braces'
}

const FIELD_GROUPS: { label: string; fields: SegmentField[] }[] = [
  {
    label: 'Contact',
    fields: ['email', 'first_name', 'last_name', 'source', 'status', 'created_at']
  },
  {
    label: 'Engagement',
    fields: ['last_opened_at', 'last_clicked_at', 'activity', 'engagement']
  },
  { label: 'Membership', fields: ['list', 'segment', 'topic'] },
  { label: 'Custom', fields: ['attribute'] }
]

type ReferenceKind = Extract<SegmentValueKind, 'list' | 'segment' | 'topic'>

const REFERENCE_PICKERS: Record<
  ReferenceKind,
  {
    label: string
    noun: string
    plural: string
    icon: string
    source: 'lists' | 'segments' | 'topics'
  }
> = {
  list: { label: 'List', noun: 'list', plural: 'lists', icon: 'i-lucide-list', source: 'lists' },
  segment: {
    label: 'Segment',
    noun: 'segment',
    plural: 'segments',
    icon: 'i-lucide-filter',
    source: 'segments'
  },
  topic: {
    label: 'Topic',
    noun: 'topic',
    plural: 'topics',
    icon: 'i-lucide-bell',
    source: 'topics'
  }
}

function isReferenceKind(kind: SegmentValueKind): kind is ReferenceKind {
  return Object.hasOwn(REFERENCE_PICKERS, kind)
}

function referenceSet(kind: SegmentValueKind): SegmentBuilderOptionSet | null {
  return isReferenceKind(kind) ? options[REFERENCE_PICKERS[kind].source].value : null
}

function groupItems(group: { label: string; fields: SegmentField[] }): SelectItem[] {
  const items: SelectItem[] = [{ type: 'label', label: group.label }]

  for (const field of group.fields) {
    const definition = segmentFieldDefinition(field)

    if (!definition.legacy || field === condition.value.field)
      items.push({ label: definition.label, value: field, icon: FIELD_ICONS[field] })
  }

  return items
}

const fieldItems = computed<SelectItem[][]>(() => FIELD_GROUPS.map(groupItems))

const property = computed(() => {
  const current = condition.value

  return current.field === 'activity' ? null : current
})

const activity = computed(() => {
  const current = condition.value

  return current.field === 'activity' ? current : null
})

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

const reference = computed(() => {
  const current = kind.value

  if (!isReferenceKind(current)) return null

  const picker = REFERENCE_PICKERS[current]
  const set = options[picker.source].value
  const selected = property.value?.value

  return {
    ...picker,
    set,
    items: optionsWithSelected(set, selected ? String(selected) : null, `Deleted ${picker.noun}`),
    placeholder:
      set.items.length || set.loading ? `Select a ${picker.noun}` : `No ${picker.plural} yet`
  }
})

function replaceCondition(target: SegmentConditionState, next: SegmentConditionState) {
  for (const key of Object.keys(target)) {
    if (!(key in next)) Reflect.deleteProperty(target, key)
  }

  Object.assign(target, next)
}

function initialValue(fieldName: SegmentField, op: SegmentOperator) {
  const valueKind = segmentValueKind(fieldName, op)
  const set = referenceSet(valueKind)

  if (set) return set.items[0]?.value ?? null

  return defaultSegmentValue(valueKind, fieldName)
}

const field = computed<SegmentField>({
  get: () => condition.value.field,
  set: (next) => {
    if (next === condition.value.field) return

    const replacement = newSegmentCondition(next)

    if (replacement.field !== 'activity')
      replacement.value = initialValue(next, replacement.operator)

    replaceCondition(condition.value, replacement)
  }
})

const operator = computed<SegmentOperator>({
  get: () => condition.value.operator,
  set: (next) => {
    const target = property.value

    if (!target) return

    const previousKind = kind.value
    target.operator = next

    if (segmentValueKind(target.field, next) !== previousKind)
      target.value = initialValue(target.field, next)
  }
})

const text = computed<string>({
  get: () => {
    const value = property.value?.value

    return value === null || value === undefined ? '' : String(value)
  },
  set: (next) => {
    if (property.value) property.value.value = next
  }
})

const key = computed<string>({
  get: () => property.value?.key ?? '',
  set: (next) => {
    if (property.value) property.value.key = next
  }
})

const referenceValue = computed<string | undefined>({
  get: () => (property.value?.value ? String(property.value.value) : undefined),
  set: (next) => {
    if (property.value) property.value.value = next ?? null
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

      <SegmentsSegmentActivityFields
        v-if="activity"
        :model-value="activity"
        :name="name"
        :readonly="readonly"
      />

      <template v-else>
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
            v-else-if="reference"
            v-model="referenceValue"
            :items="reference.items"
            value-key="value"
            :loading="reference.set.loading"
            :placeholder="reference.placeholder"
            :search-input="{ placeholder: `Search ${reference.plural}…` }"
            :icon="reference.icon"
            :aria-label="reference.label"
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
      </template>
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
