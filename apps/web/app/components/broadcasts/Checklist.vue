<script setup lang="ts">
import type { BroadcastPreflight, ChecklistStatus } from '#shared/types/broadcasts'

/** Pre-flight checklist: every item is ok, a warning or a blocker. */
const props = defineProps<{
  preflight: BroadcastPreflight | null
  pending?: boolean
  error?: boolean
}>()

defineEmits<{ retry: [] }>()

const ICONS: Record<ChecklistStatus, { icon: string; class: string; label: string }> = {
  ok: { icon: 'i-lucide-circle-check', class: 'text-success', label: 'Done' },
  warning: { icon: 'i-lucide-circle-alert', class: 'text-warning', label: 'Warning' },
  blocker: { icon: 'i-lucide-circle-x', class: 'text-error', label: 'Blocker' }
}

const { relative } = useFormat()
const now = useRelativeNow()

const blockers = computed(
  () => props.preflight?.items.filter((i) => i.status === 'blocker').length ?? 0
)

const warnings = computed(
  () => props.preflight?.items.filter((i) => i.status === 'warning').length ?? 0
)

const summary = computed(() => {
  if (!props.preflight) return ''

  if (blockers.value)
    return `${blockers.value} ${blockers.value === 1 ? 'blocker' : 'blockers'}${warnings.value ? ` · ${warnings.value} ${warnings.value === 1 ? 'warning' : 'warnings'}` : ''}`

  if (warnings.value)
    return `Ready · ${warnings.value} ${warnings.value === 1 ? 'warning' : 'warnings'}`

  return 'Ready to send'
})

/** Blockers first, then warnings, then the rest (stable within a group). */
const ORDER: Record<ChecklistStatus, number> = { blocker: 0, warning: 1, ok: 2 }

const items = computed(() =>
  (props.preflight?.items ?? []).toSorted((a, b) => ORDER[a.status] - ORDER[b.status])
)
</script>

<template>
  <section class="rounded-lg ring ring-default" aria-labelledby="preflight-title">
    <header class="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
      <h2 id="preflight-title" class="text-sm font-semibold text-highlighted">Pre-flight</h2>
      <span
        class="flex items-center gap-1.5 text-xs"
        :class="blockers ? 'text-error' : 'text-muted'"
        aria-live="polite"
      >
        <UIcon
          v-if="pending"
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin text-muted"
          aria-hidden="true"
        />
        {{ summary }}
      </span>
    </header>

    <EmptyState
      v-if="error && !preflight"
      compact
      variant="error"
      title="Couldn't run the checks"
      description="Sending stays locked until the checks pass."
      class="border-t border-default"
    >
      <UButton
        label="Retry"
        icon="i-lucide-rotate-cw"
        variant="outline"
        size="sm"
        @click="$emit('retry')"
      />
    </EmptyState>

    <ul
      v-else-if="!preflight"
      class="border-t border-default divide-y divide-default"
      aria-busy="true"
      aria-label="Running checks"
    >
      <li v-for="i in 6" :key="i" class="flex gap-2.5 px-4 py-2.5">
        <USkeleton class="size-4 rounded-full shrink-0" />
        <div class="flex-1 space-y-1.5">
          <USkeleton class="h-3.5 w-24" />
          <USkeleton class="h-3 w-40" />
        </div>
      </li>
    </ul>

    <ul
      v-else
      class="border-t border-default divide-y divide-default"
      :class="pending && 'opacity-70 transition-opacity'"
    >
      <li v-for="item in items" :key="item.key" class="flex gap-2.5 px-4 py-2.5">
        <UIcon
          :name="ICONS[item.status].icon"
          class="size-4 shrink-0 mt-px"
          :class="ICONS[item.status].class"
          aria-hidden="true"
        />
        <div class="min-w-0">
          <p class="text-[13px] font-medium text-highlighted">
            <span class="sr-only">{{ ICONS[item.status].label }}: </span>{{ item.label }}
          </p>
          <p class="text-xs text-muted break-words line-clamp-2">
            <template v-if="item.key === 'test' && preflight.lastTestAt">
              Last test sent {{ relative(preflight.lastTestAt, now) }}.
            </template>
            <template v-else>
              {{ item.detail }}
            </template>
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>
