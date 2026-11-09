<script setup lang="ts" generic="S extends SettingsSection">
import type { VNode } from 'vue'
import type { z } from 'zod'
import { settingsSchemas } from '#shared/schemas/settings'
import type { SettingsMap, SettingsSection } from '#shared/types/domain'

/**
 * Loads one settings section of the active organization and owns its editable
 * copy. Pages render several <SettingsCard>s from it; `group(keys)` binds a card
 * to a subset of fields so each card validates, saves and discards only its own
 * fields. Editing needs `settings:update`; limits are always read-only here
 * (instance administrators set them).
 */
type Value = SettingsMap[S]

type Key = keyof Value & string

interface SettingsCardBinding {
  schema: z.ZodType
  state: object
  dirty: boolean
  saving: boolean
  readonly: boolean
  onSubmit: () => void
  onDiscard: () => void
}

const props = withDefaults(
  defineProps<{
    section: S
    /** Show the read-only / limits notice; off for a section embedded in another page. */
    notice?: boolean
  }>(),
  { notice: true }
)

const emit = defineEmits<{ saved: [keys: readonly Key[]] }>()

defineSlots<{
  default(props: {
    state: Value
    saved: Value
    canEdit: boolean
    group: (keys: readonly Key[]) => SettingsCardBinding
    isDirty: (keys?: readonly Key[]) => boolean
    save: (keys: readonly Key[]) => Promise<boolean>
  }): VNode[]
}>()

/** Every section schema is an object schema, so cards can pick their fields. */
const sectionSchemas: Readonly<Record<SettingsSection, z.ZodObject>> = settingsSchemas

const { organization, can, isInstanceAdmin } = useOrganization()

const isLimits = computed(() => props.section === 'limits')
const canEdit = computed(() => !isLimits.value && can({ settings: ['update'] }))

const url: string = `/api/settings/${props.section}`

// Keyed by organization, so a cached section of another organization is never shown or saved.
const { data, error, refresh, status } = await useFetch<Value>(url, {
  key: () => `settings:${organization.value?.id ?? 'none'}:${props.section}`
})

// SAFETY: useFetch<Value> resolves to the section returned by GET /api/settings/[section];
// Nuxt's PickFrom<Value, []> is Value itself but stays unresolved for the generic S.
const loaded = (): Value | undefined => data.value as Value | undefined

function clone<T>(value: T): T {
  return structuredClone(toRaw(value))
}

// SAFETY: a section value is never a Ref, so shallowRef keeps it as ShallowRef<Value>; the
// generic S leaves that conditional type unresolved.
const saved = shallowRef(clone(loaded())) as ShallowRef<Value | undefined>

// SAFETY: section values are plain JSON without refs, so UnwrapRef<Value> is Value; the
// generic S keeps TypeScript from resolving that.
const state = ref(clone(loaded())) as Ref<Value | undefined>

watch(data, () => {
  saved.value = clone(loaded())
  state.value = clone(loaded())
})

const allKeys = computed<Key[]>(() =>
  Object.keys(saved.value ?? {}).filter((key): key is Key => !!saved.value && key in saved.value)
)

const savingKeys = ref<string | null>(null)

function same<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isDirty(keys: readonly Key[] = allKeys.value) {
  if (!state.value || !saved.value) return false

  return keys.some((key) => !same(state.value?.[key], saved.value?.[key]))
}

function discard(keys: readonly Key[]) {
  if (!state.value || !saved.value) return

  for (const key of keys) state.value[key] = clone(saved.value[key])
}

const { run: put } = useApiAction((body: Value) => $fetch<Value>(url, { method: 'PUT', body }), {
  success: 'Settings saved',
  error: 'Could not save settings'
})

async function save(keys: readonly Key[]): Promise<boolean> {
  if (!state.value || !saved.value || !canEdit.value) return false
  const body = clone(saved.value)

  for (const key of keys) body[key] = clone(state.value[key])
  savingKeys.value = keys.join(',')
  const result = await put(body)
  savingKeys.value = null

  if (!result) return false
  saved.value = clone(result)

  // Only the saved fields are reset from the server; other cards keep their edits.
  for (const key of keys) state.value[key] = clone(result[key])
  emit('saved', keys)

  return true
}

function group(keys: readonly Key[]): SettingsCardBinding {
  const mask: Record<string, true> = Object.fromEntries(keys.map((key) => [key, true] as const))

  return {
    schema: sectionSchemas[props.section].pick(mask),
    state: state.value ?? {},
    dirty: isDirty(keys),
    saving: savingKeys.value === keys.join(','),
    readonly: !canEdit.value,
    onSubmit: () => void save(keys),
    onDiscard: () => discard(keys)
  }
}

const confirm = useConfirm()

onBeforeRouteLeave(async () => {
  if (!canEdit.value || !isDirty()) return true

  return confirm({
    title: 'Discard unsaved changes?',
    description: 'Some settings on this page have not been saved.',
    confirmLabel: 'Discard changes',
    danger: true
  })
})
</script>

<template>
  <EmptyState
    v-if="error || !state || !saved"
    variant="error"
    appearance="outline"
    title="Settings could not be loaded"
    :description="error ? apiErrorMessage(error) : 'Check your connection and try again.'"
  >
    <UButton
      label="Retry"
      icon="i-lucide-refresh-cw"
      variant="outline"
      :loading="status === 'pending'"
      @click="refresh()"
    />
  </EmptyState>
  <template v-else>
    <UAlert
      v-if="notice && isLimits"
      icon="i-lucide-lock"
      title="Limits are set by your instance administrator"
      :description="
        isInstanceAdmin
          ? 'Change the limits of any organization in the admin area.'
          : 'Contact your instance administrator to raise a limit.'
      "
      :actions="
        isInstanceAdmin
          ? [
              {
                label: 'Manage organizations',
                to: '/admin/organizations',
                variant: 'outline',
                size: 'sm',
                trailingIcon: 'i-lucide-arrow-right'
              }
            ]
          : []
      "
    />
    <UAlert
      v-else-if="notice && !canEdit"
      icon="i-lucide-lock"
      title="You can view these settings"
      description="Ask an owner or admin to change them."
    />
    <slot
      :state="state"
      :saved="saved"
      :can-edit="canEdit"
      :group="group"
      :is-dirty="isDirty"
      :save="save"
    />
  </template>
</template>
