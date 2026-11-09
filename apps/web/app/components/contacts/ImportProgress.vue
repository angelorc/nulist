<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ImportDetail } from '#shared/types/contacts'
import type { ImportRowError } from '#shared/types/domain'

const props = defineProps<{ importId: string }>()
const emit = defineEmits<{ finished: [detail: ImportDetail]; reset: [] }>()

const { number, percent } = useFormat()
const { can } = useOrganization()
const canImport = computed(() => can({ contact: ['import'] }))
const canReadLists = computed(() => can({ list: ['read'] }))

const url = computed<string>(() => `/api/imports/${props.importId}`)

const {
  data: detail,
  refresh,
  error,
  status
} = useFetch<ImportDetail>(url, { key: computed(() => `import-${props.importId}`) })

const running = computed(
  () => detail.value?.status === 'pending' || detail.value?.status === 'processing'
)

const { pause, resume } = useIntervalFn(() => refresh(), 1000, { immediate: false })

watch(
  running,
  (value) => {
    if (value) resume()
    else pause()
  },
  { immediate: true }
)

/** Completed or failed: nothing left to poll. */
const settled = computed(() => !!detail.value && !running.value)

// Tell the page once the import settles, also when it ended before the first poll.
watch(settled, (value) => {
  if (value && detail.value) emit('finished', detail.value)
})

const progress = computed(() => {
  const d = detail.value

  if (!d) return null

  if (d.status === 'pending' || !d.totalRows) return null

  return Math.min(100, Math.round((d.processedRows / d.totalRows) * 1000) / 10)
})

const counters = computed(() => {
  const d = detail.value

  return [
    { label: 'Created', value: d?.createdCount ?? 0, hint: 'New contacts' },
    { label: 'Updated', value: d?.updatedCount ?? 0, hint: 'Existing contacts changed' },
    {
      label: 'Skipped',
      value: d?.skippedCount ?? 0,
      hint: 'Duplicates or existing contacts left as they were'
    },
    { label: 'Errors', value: d?.errorCount ?? 0, hint: 'Rows that could not be imported' }
  ]
})

const headline = computed(() => {
  switch (detail.value?.status) {
    case 'pending':
      return 'Reading the file…'
    case 'processing':
      return 'Importing contacts…'
    case 'completed':
      return 'Import complete'
    case 'failed':
      return 'Import failed'
    default:
      return 'Import'
  }
})

const columns: TableColumn<ImportRowError>[] = [
  {
    accessorKey: 'row',
    header: 'Row',
    meta: { class: { th: 'w-20', td: 'w-20 tabular-nums text-muted' } },
    cell: ({ row }) => row.original.row || emptyCell()
  },
  {
    accessorKey: 'email',
    header: 'Email',
    meta: { class: { th: 'w-1/3', td: 'w-1/3 font-mono text-xs truncate' } },
    cell: ({ row }) => row.original.email ?? emptyCell()
  },
  {
    accessorKey: 'message',
    header: 'Problem',
    meta: { class: { td: 'text-default whitespace-normal' } }
  }
]

/** The import's list when the member can open it, otherwise the contacts page. */
const contactsLink = computed(() =>
  detail.value?.listId && canReadLists.value ? `/lists/${detail.value.listId}` : '/contacts'
)
</script>

<template>
  <section class="rounded-lg ring ring-default overflow-hidden" aria-label="Import progress">
    <EmptyState
      v-if="error && !detail"
      variant="error"
      title="Couldn't load this import"
      :description="error.statusCode === 404 ? 'It may have been removed.' : apiErrorMessage(error)"
      compact
    >
      <UButton
        label="Retry"
        variant="outline"
        :loading="status === 'pending'"
        @click="() => refresh()"
      />
    </EmptyState>

    <div v-else-if="!detail" aria-busy="true">
      <div class="p-4 space-y-3">
        <USkeleton class="h-5 w-48" />
        <USkeleton class="h-3.5 w-64" />
        <USkeleton class="h-2 w-full" />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-(--ui-border) border-t border-default">
        <KpiCard v-for="n in 4" :key="n" label="" loading class="bg-default" />
      </div>
    </div>

    <template v-else>
      <div class="p-4 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p
              class="text-base font-semibold text-highlighted flex items-center gap-2"
              aria-live="polite"
            >
              <UIcon
                v-if="running"
                name="i-lucide-loader-circle"
                class="size-4 animate-spin text-muted"
                aria-hidden="true"
              />
              {{ headline }}
            </p>
            <p class="text-[13px] text-muted truncate mt-0.5">
              <span class="font-mono">{{ detail.fileName }}</span>
              <template v-if="detail.listName"> → {{ detail.listName }} </template>
              · started <TimeAgo :date="detail.createdAt" />
            </p>
          </div>
          <StatusBadge :status="detail.status" />
        </div>

        <div class="space-y-1.5">
          <UProgress
            :model-value="progress"
            :color="
              detail.status === 'failed'
                ? 'error'
                : detail.status === 'completed'
                  ? 'success'
                  : 'primary'
            "
            size="sm"
          />
          <div class="flex justify-between text-xs text-muted tabular-nums">
            <span>{{ number(detail.processedRows) }} of {{ number(detail.totalRows) }} rows</span>
            <span v-if="progress !== null">{{ percent(progress / 100) }}</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-(--ui-border) border-t border-default">
        <KpiCard
          v-for="counter in counters"
          :key="counter.label"
          :label="counter.label"
          :value="counter.value"
          :hint="counter.hint"
          class="bg-default"
        />
      </div>

      <div v-if="detail.errors.length" class="border-t border-default p-4 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium text-highlighted">Problems</p>
          <p v-if="detail.errorCount > detail.errors.length" class="text-xs text-muted">
            Showing the first {{ number(detail.errors.length) }} of {{ number(detail.errorCount) }}
          </p>
        </div>
        <UTable
          :data="detail.errors"
          :columns="columns"
          sticky
          :ui="tableUi"
          caption="Rows that could not be imported"
          class="max-h-72"
        />
      </div>

      <div
        v-if="!running"
        class="border-t border-default px-4 py-3 flex flex-wrap items-center justify-end gap-2"
      >
        <UButton
          v-if="canImport"
          label="Import another file"
          icon="i-lucide-upload"
          variant="ghost"
          @click="emit('reset')"
        />
        <UButton
          :label="detail.listId && canReadLists ? 'View list' : 'View contacts'"
          trailing-icon="i-lucide-arrow-right"
          variant="outline"
          :to="contactsLink"
        />
      </div>
    </template>
  </section>
</template>
