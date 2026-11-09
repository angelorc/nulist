<script setup lang="ts">
import {
  ATTRIBUTE_KEY_PATTERN,
  attributeValueKind,
  attributeValueSchema,
  coerceAttributeValue,
  formatAttributeValue,
  toAttributeKey
} from '#shared/schemas/contacts'
import type { AttributeValueKind, ContactUpdateInput } from '#shared/schemas/contacts'
import type { AttributeValue, ContactRecord } from '#shared/types/contacts'
import type { JsonObject } from '#shared/types/domain'

const props = defineProps<{
  contactId: string
  attributes: JsonObject
  /** Without `contact:update`: values are shown, nothing can be changed. */
  readonly?: boolean
}>()

const emit = defineEmits<{ saved: [] }>()

interface Row {
  uid: number
  key: string
  text: string
  /** Scalar loaded from the server; keeps its type (number, boolean) while its text is untouched. */
  original?: AttributeValue
}

let uid = 0
const rows = ref<Row[]>([])
const tableEl = useTemplateRef<HTMLElement>('table')

function reset() {
  rows.value = Object.entries(props.attributes ?? {}).map(([key, value]) => {
    const scalar = attributeValueSchema.safeParse(value)

    return {
      uid: ++uid,
      key,
      text: formatAttributeValue(value),
      original: scalar.success ? scalar.data : undefined
    }
  })
}

watch(() => props.attributes, reset, { immediate: true, deep: true })

/** Untouched values keep their stored type; edited text is coerced (numbers, booleans). */
function valueOf(row: Row): AttributeValue {
  if (row.original !== undefined && formatAttributeValue(row.original) === row.text)
    return row.original

  return coerceAttributeValue(row.text)
}

function typeOf(row: Row): AttributeValueKind {
  return attributeValueKind(valueOf(row))
}

const payload = computed(() =>
  Object.fromEntries(rows.value.filter((r) => r.key.trim()).map((r) => [r.key.trim(), valueOf(r)]))
)

const dirty = computed(
  () =>
    JSON.stringify(payload.value) !== JSON.stringify(props.attributes ?? {}) ||
    rows.value.some((r) => !r.key.trim() && r.text)
)

const errors = computed(() => {
  const seen = new Set<string>()
  const result: Record<number, string> = {}

  for (const row of rows.value) {
    const key = row.key.trim()

    if (!key) {
      if (row.text) result[row.uid] = 'Add a key'
      continue
    }

    if (!ATTRIBUTE_KEY_PATTERN.test(key)) result[row.uid] = 'Letters, numbers and _ only'
    else if (seen.has(key)) result[row.uid] = 'Duplicate key'
    seen.add(key)
  }

  return result
})

const valid = computed(() => Object.keys(errors.value).length === 0)

async function add() {
  rows.value.push({ uid: ++uid, key: '', text: '' })
  await nextTick()
  const inputs = tableEl.value?.querySelectorAll<HTMLInputElement>('input[data-key]')
  inputs?.[inputs.length - 1]?.focus()
}

function remove(row: Row) {
  rows.value = rows.value.filter((r) => r.uid !== row.uid)
}

function normalizeKey(row: Row) {
  if (row.key.trim() && !ATTRIBUTE_KEY_PATTERN.test(row.key.trim()))
    row.key = toAttributeKey(row.key)
}

const { run, pending } = useApiAction(
  (): Promise<ContactRecord> => {
    const url: string = `/api/contacts/${props.contactId}`

    const body = {
      attributes: payload.value,
      attributesMode: 'replace'
    } satisfies ContactUpdateInput

    return $fetch<ContactRecord>(url, { method: 'PATCH', body })
  },
  { success: 'Attributes saved' }
)

async function save() {
  if (props.readonly || !valid.value || !dirty.value) return

  if (await run()) emit('saved')
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="rows.length"
      ref="table"
      class="rounded-lg ring ring-default divide-y divide-default"
    >
      <div
        class="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem_2rem] gap-2 px-3 py-2 text-[13px] font-medium text-muted bg-elevated/50 rounded-t-lg"
      >
        <span>Key</span>
        <span>Value</span>
        <span>Type</span>
        <span class="sr-only">Actions</span>
      </div>
      <div
        v-for="row in rows"
        :key="row.uid"
        class="grid grid-cols-[minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem_2rem] gap-2 px-3 py-2 items-start"
      >
        <UFormField :error="errors[row.uid]" :ui="{ error: 'px-2.5' }" class="min-w-0">
          <UInput
            v-model="row.key"
            data-key
            placeholder="key"
            size="sm"
            variant="ghost"
            :disabled="readonly"
            class="w-full"
            :ui="{ base: 'font-mono' }"
            :aria-label="`Attribute key ${row.key}`"
            @blur="normalizeKey(row)"
            @keydown.enter.prevent="save"
          />
        </UFormField>
        <UButton
          v-if="!readonly"
          icon="i-lucide-x"
          variant="ghost"
          size="sm"
          class="sm:hidden"
          :aria-label="`Remove ${row.key || 'attribute'}`"
          @click="remove(row)"
        />
        <UInput
          v-model="row.text"
          placeholder="value"
          size="sm"
          variant="ghost"
          :disabled="readonly"
          class="w-full col-span-2 sm:col-span-1"
          :aria-label="`Value of ${row.key || 'attribute'}`"
          @keydown.enter.prevent="save"
        />
        <span class="hidden sm:inline-flex h-7 items-center text-xs text-muted font-mono">{{
          typeOf(row)
        }}</span>
        <UButton
          v-if="!readonly"
          icon="i-lucide-x"
          variant="ghost"
          size="sm"
          class="hidden sm:inline-flex"
          :aria-label="`Remove ${row.key || 'attribute'}`"
          @click="remove(row)"
        />
      </div>
    </div>
    <EmptyState
      v-else
      icon="i-lucide-braces"
      title="No custom attributes"
      description="Store plans, cities or IDs here, then use them in templates and segment rules."
      appearance="outline"
      compact
    />

    <div v-if="!readonly" class="flex items-center justify-between gap-2">
      <UButton label="Add attribute" icon="i-lucide-plus" variant="ghost" size="sm" @click="add" />
      <div class="flex items-center gap-2">
        <UButton v-if="dirty" label="Discard" variant="ghost" size="sm" @click="reset" />
        <UButton
          label="Save attributes"
          variant="outline"
          size="sm"
          :disabled="!dirty || !valid"
          :loading="pending"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
