<script lang="ts">
export interface DetailRow {
  label: string
  value?: string | number | null
  /** Render as an ID with a copy button. */
  copy?: boolean
  /** Render in the mono face (paths, keys, addresses). */
  mono?: boolean
  /** Internal link target. */
  to?: string
}
</script>

<script setup lang="ts">
/** Label / value rows of a log detail: IDs copy, mono values, related records link. */
defineProps<{ rows: DetailRow[] }>()
</script>

<template>
  <dl class="rounded-lg ring ring-default divide-y divide-default">
    <div
      v-for="row in rows"
      :key="row.label"
      class="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 px-3 py-2 text-[13px]"
    >
      <dt class="text-muted truncate">
        {{ row.label }}
      </dt>
      <dd class="min-w-0">
        <span
          v-if="row.value === null || row.value === undefined || row.value === ''"
          class="text-dimmed"
          >—</span
        >
        <CopyText v-else-if="row.copy" :value="String(row.value)" class="max-w-full" />
        <ULink
          v-else-if="row.to"
          :to="row.to"
          class="text-primary hover:text-primary hover:underline underline-offset-2 break-words"
        >
          {{ row.value }}
        </ULink>
        <span
          v-else
          class="text-highlighted break-words"
          :class="row.mono && 'font-mono text-xs'"
          >{{ row.value }}</span
        >
      </dd>
    </div>
  </dl>
</template>
