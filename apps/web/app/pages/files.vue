<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import { fileTypeFilterSchema } from '#shared/schemas/files'
import type { FileDto, FileTypeFilter, StorageStatus } from '#shared/schemas/files'

definePageMeta({ permission: { file: ['read'] } })

useSeoMeta({ title: 'Files' })

/** Filters kept in the URL (a plain object type, as usePaginatedList expects). */
type FileFilters = { type: FileTypeFilter | undefined }

const { number, bytes } = useFormat()
const { can } = useOrganization()
const confirm = useConfirm()
const zone = useTemplateRef('zone')
const searchInput = useTemplateRef('search')

const canUpload = computed(() => can({ file: ['create'] }))
const canConfigureStorage = computed(() => can({ settings: ['update'] }))

const {
  data: storage,
  status: storageStatus,
  refresh: refreshStorage
} = await useFetch<StorageStatus>('/api/files/status')

const storageReady = computed(() => storage.value?.state === 'ready')

const {
  page,
  pageSize,
  q,
  filters,
  items,
  total,
  loading,
  error,
  refresh,
  isFiltered,
  clearFilters
} = usePaginatedList<FileDto, FileFilters>('/api/files', {
  pageSize: 48,
  filters: { type: undefined }
})

const typeTabs: TabsItem[] = [
  { label: 'All', value: 'all' },
  { label: 'Images', value: 'image', icon: 'i-lucide-image' },
  { label: 'Documents', value: 'other', icon: 'i-lucide-file-text' }
]

const typeFilter = computed({
  get: () => filters.type ?? 'all',
  set: (value: string | number) => {
    const parsed = fileTypeFilterSchema.safeParse(value)
    filters.type = parsed.success ? parsed.data : undefined
  }
})

const usage = computed(() => {
  if (!storage.value) return ''
  const used = `${number(storage.value.fileCount)} ${storage.value.fileCount === 1 ? 'file' : 'files'} · ${bytes(storage.value.usedBytes)}`

  return storage.value.maxStorageMb ? `${used} of ${number(storage.value.maxStorageMb)} MB` : used
})

const uploadHint = computed(() => {
  const max = storage.value?.maxFileSizeMb

  return `PNG, JPG, GIF, WebP, SVG or PDF${max ? ` up to ${max} MB` : ''}. You can also paste images.`
})

const storageHelp = computed(() =>
  canConfigureStorage.value
    ? 'Connect an S3-compatible bucket to upload images for your emails.'
    : 'An owner or admin of this organization needs to connect an S3-compatible bucket.'
)

const uploadDenied = computed(() =>
  storageReady.value
    ? "You don't have permission to upload files"
    : 'Configure file storage to upload files'
)

function openUpload() {
  if (canUpload.value && storageReady.value) zone.value?.open()
}

async function onUploaded() {
  await Promise.all([refresh(), refreshStorage()])
}

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/files/${id}`, { method: 'DELETE' }),
  { success: 'File deleted' }
)

async function onDelete(file: FileDto) {
  const ok = await confirm({
    title: `Delete "${file.name}"?`,
    description:
      "Emails and templates that reference this URL will show a broken image. This can't be undone.",
    confirmLabel: 'Delete file',
    danger: true
  })

  if (ok && (await remove(file.id)) !== undefined) await onUploaded()
}

// Paste images anywhere on the page (ignored while typing in a field, or without file:create).
useEventListener('paste', (event: ClipboardEvent) => {
  if (!canUpload.value || !storageReady.value || !zone.value) return
  const target = event.target

  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]'))
    return
  const pasted = Array.from(event.clipboardData?.files ?? [])

  if (!pasted.length) return
  event.preventDefault()
  void zone.value.upload(pasted)
})

async function retry() {
  await Promise.all([refreshStorage(), refresh()])
}

// `n` uploads, `/` searches; neither is bound when it cannot be used.
defineShortcuts(
  computed(() => ({
    n: canUpload.value && storageReady.value ? openUpload : false,
    '/': storageReady.value ? () => searchInput.value?.inputRef?.focus() : false
  }))
)
</script>

<template>
  <UDashboardPanel id="files">
    <template #header>
      <UDashboardNavbar title="Files">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <span v-if="usage" class="hidden sm:inline text-[13px] text-muted tabular-nums">
            {{ usage }}
          </span>
        </template>
        <template #right>
          <UTooltip v-if="canUpload && storageReady" text="Upload files" :kbds="['n']">
            <UButton label="Upload files" icon="i-lucide-upload" @click="openUpload" />
          </UTooltip>
          <UTooltip v-else :text="uploadDenied">
            <span class="inline-flex" tabindex="0">
              <UButton label="Upload files" icon="i-lucide-upload" disabled />
            </span>
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        v-if="storageReady"
        :ui="{ root: 'flex-wrap gap-y-2 py-2 sm:py-0', right: 'w-full sm:w-auto' }"
      >
        <template #left>
          <UTabs
            v-model="typeFilter"
            :items="typeTabs"
            :content="false"
            size="xs"
            color="neutral"
            aria-label="Filter by type"
            :ui="{ list: 'w-auto' }"
          />
        </template>
        <template #right>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search files…"
            size="sm"
            class="w-full sm:w-64"
            aria-label="Search files"
          >
            <template #trailing>
              <UKbd value="/" class="hidden sm:inline-flex" />
            </template>
          </UInput>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div
        v-if="storageStatus === 'pending' && !storage"
        class="flex flex-col gap-4"
        aria-busy="true"
      >
        <USkeleton class="h-36 w-full rounded-lg" />
        <FilesGridSkeleton />
      </div>

      <EmptyState
        v-else-if="!storageReady"
        variant="error"
        appearance="outline"
        :title="
          storage?.state === 'not_configured'
            ? 'File storage is not configured'
            : 'File storage is unavailable'
        "
        :description="storage?.message ?? storageHelp"
      >
        <UButton
          v-if="canConfigureStorage"
          label="Open storage settings"
          icon="i-lucide-hard-drive"
          to="/settings/storage"
        />
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          :loading="storageStatus === 'pending'"
          @click="retry"
        />
      </EmptyState>

      <template v-else>
        <FilesUploadZone
          v-if="canUpload"
          ref="zone"
          :max-file-size-mb="storage?.maxFileSizeMb ?? 0"
          :description="uploadHint"
          :compact="items.length > 0"
          @complete="onUploaded"
        />

        <EmptyState
          v-if="error && !loading"
          variant="error"
          appearance="outline"
          title="Couldn't load files"
          :description="apiErrorMessage(error)"
        >
          <UButton
            label="Retry"
            icon="i-lucide-rotate-cw"
            variant="outline"
            @click="() => refresh()"
          />
        </EmptyState>

        <FilesGridSkeleton v-else-if="loading && !items.length" />

        <ul
          v-else-if="items.length"
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4 transition-opacity"
          :class="loading && 'opacity-60'"
          :aria-busy="loading"
        >
          <li v-for="file in items" :key="file.id" class="min-w-0">
            <FilesTile :file="file" @delete="onDelete" />
          </li>
        </ul>

        <EmptyState
          v-else-if="isFiltered"
          variant="no-results"
          appearance="outline"
          title="No files match your filters"
          description="Try another type or search term."
        >
          <UButton label="Clear filters" variant="outline" @click="clearFilters" />
        </EmptyState>

        <EmptyState
          v-else-if="canUpload"
          icon="i-lucide-image"
          title="No files yet"
          description="Upload logos, banners and attachments once and reuse their URLs in every template."
        />

        <EmptyState
          v-else
          icon="i-lucide-image"
          appearance="outline"
          title="No files yet"
          description="Files uploaded by your team appear here."
        />

        <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="file" />
      </template>
    </template>
  </UDashboardPanel>
</template>
