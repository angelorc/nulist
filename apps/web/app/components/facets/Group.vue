<script lang="ts">
import type { BadgeProps } from '@nuxt/ui'

export type FacetColor = NonNullable<BadgeProps['color']>

export interface FacetOption {
  value: string
  label: string
  count: number | null
  icon?: string
  color?: FacetColor
  description?: string
}
</script>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    items: FacetOption[]
    loading?: boolean
    limit?: number
    single?: boolean
    defaultOpen?: boolean
  }>(),
  { loading: false, limit: 6, single: false, defaultOpen: true }
)

const model = defineModel<string | undefined>()

const DOT: Record<FacetColor, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-(--ui-color-neutral-400)'
}

const { number, compact } = useFormat()

const open = ref(props.defaultOpen)
const expanded = ref(false)

const selected = computed(() => (model.value ? model.value.split(',').filter(Boolean) : []))
const selectedSet = computed(() => new Set(selected.value))

const options = computed<FacetOption[]>(() => {
  const known = new Set(props.items.map((item) => item.value))

  const missing = selected.value
    .filter((value) => !known.has(value))
    .map((value) => ({ value, label: value, count: null }))

  return [...props.items, ...missing]
})

const rows = computed(() => {
  if (options.value.length < 3) {
    return options.value
  }

  return options.value.filter((item) => item.count !== 0 || selectedSet.value.has(item.value))
})

const shown = computed(() =>
  expanded.value
    ? rows.value
    : rows.value.filter((item, index) => index < props.limit || selectedSet.value.has(item.value))
)

const hiddenCount = computed(() => rows.value.length - shown.value.length)
const canCollapse = computed(() => expanded.value && rows.value.length > props.limit)

const maxCount = computed(() => Math.max(0, ...rows.value.map((item) => item.count ?? 0)))

function share(item: FacetOption) {
  if (!item.count || !maxCount.value) {
    return '0%'
  }

  return `${Math.round((item.count / maxCount.value) * 100)}%`
}

function commit(values: string[]) {
  model.value = values.length ? values.join(',') : undefined
}

function toggle(value: string) {
  if (selectedSet.value.has(value)) {
    commit(selected.value.filter((item) => item !== value))

    return
  }

  commit(props.single ? [value] : [...selected.value, value])
}

function only(value: string) {
  commit([value])
}

function clear() {
  commit([])
}

function isOnly(value: string) {
  return selected.value.length === 1 && selected.value[0] === value
}
</script>

<template>
  <section :aria-label="title">
    <div class="flex h-8 items-center gap-1">
      <UButton
        :label="title"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-chevron-right"
        :aria-expanded="open"
        class="min-w-0 flex-1 px-1.5 font-medium text-highlighted"
        :ui="{
          leadingIcon: ['size-4 text-dimmed transition-transform duration-150', open && 'rotate-90']
        }"
        @click="open = !open"
      >
        <template #trailing>
          <UBadge v-if="selected.length" :label="selected.length" class="tabular-nums" />
        </template>
      </UButton>
      <UButton
        v-if="selected.length"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="`Clear ${title} filter`"
        class="text-muted"
        @click="clear"
      />
    </div>

    <UCollapsible :open="open">
      <template #content>
        <ul v-if="loading && !options.length" aria-busy="true" class="flex flex-col py-0.5">
          <li v-for="index in 3" :key="index" class="flex h-8 items-center gap-2 px-2">
            <USkeleton class="size-4 rounded-sm" />
            <USkeleton class="h-3 flex-1" />
            <USkeleton class="h-3 w-6" />
          </li>
        </ul>

        <p v-else-if="!rows.length" class="flex h-8 items-center px-2 text-xs text-muted">
          No values
        </p>

        <ul v-else :aria-label="title" :aria-busy="loading" class="flex flex-col py-0.5">
          <li
            v-for="item in shown"
            :key="item.value"
            class="group/row relative flex h-8 items-center gap-2 rounded-md px-2 hover:bg-elevated/60 focus-within:bg-elevated/60"
            :title="item.description"
          >
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-2 bottom-0.5 h-0.5 overflow-hidden rounded-full"
            >
              <span
                class="block h-full rounded-full bg-primary/40 transition-[width] duration-200"
                :style="{ width: share(item) }"
              />
            </span>

            <UCheckbox
              :model-value="selectedSet.has(item.value)"
              size="sm"
              class="relative min-w-0 flex-1"
              :ui="{
                root: 'items-center',
                wrapper: 'ms-2 min-w-0 flex-1',
                label: [
                  'flex min-w-0 items-center gap-1.5 text-[13px] font-normal',
                  selectedSet.has(item.value)
                    ? 'text-highlighted'
                    : item.count === 0
                      ? 'text-muted'
                      : 'text-default'
                ]
              }"
              @update:model-value="toggle(item.value)"
            >
              <template #label>
                <UIcon v-if="item.icon" :name="item.icon" class="size-3.5 shrink-0 text-muted" />
                <span
                  v-else-if="item.color"
                  aria-hidden="true"
                  class="size-1.5 shrink-0 rounded-full"
                  :class="DOT[item.color]"
                />
                <span class="truncate">{{ item.label }}</span>
              </template>
            </UCheckbox>

            <UButton
              v-if="!single && !isOnly(item.value)"
              label="Only"
              color="neutral"
              variant="link"
              size="xs"
              :aria-label="`Only ${item.label}`"
              class="relative hidden px-0 text-muted group-hover/row:inline-flex group-focus-within/row:inline-flex"
              @click="only(item.value)"
            />

            <span
              class="relative shrink-0 text-xs text-muted tabular-nums"
              :class="loading && 'opacity-60'"
              :title="item.count === null ? undefined : number(item.count)"
            >
              {{ item.count === null ? '—' : compact(item.count) }}
            </span>
          </li>
        </ul>

        <UButton
          v-if="hiddenCount > 0 || canCollapse"
          :label="hiddenCount > 0 ? `Show ${hiddenCount} more` : 'Show less'"
          color="neutral"
          variant="link"
          size="xs"
          class="ms-2 text-muted"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        />
      </template>
    </UCollapsible>
  </section>
</template>
