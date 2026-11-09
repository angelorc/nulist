<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { z } from 'zod'
import { IMAGE_ACCEPT } from '#shared/schemas/files'
import type { FileDto, StorageStatus } from '#shared/schemas/files'
import type { Paginated } from '#shared/types/domain'

/**
 * Picks an image from the organization's file manager (or uploads a new one with
 * `file:create`), or takes an external URL. Resolves with the image URL.
 */
const props = withDefaults(defineProps<{ title?: string; current?: string | null }>(), {
  title: 'Choose an image'
})

const emit = defineEmits<{ close: [url: string | null] }>()

const { can } = useOrganization()
const canUpload = computed(() => can({ file: ['create'] }))
const canConfigureStorage = computed(() => can({ settings: ['update'] }))

const q = ref('')
const debouncedQ = refDebounced(q, 250)
const page = ref(1)
const pageSize = 24

watch(debouncedQ, () => {
  page.value = 1
})

const { data: storage } = useFetch<StorageStatus>('/api/files/status', {
  key: 'files-status-picker'
})

const { data, status, refresh } = useFetch<Paginated<FileDto>>('/api/files', {
  query: computed(() => ({
    type: 'image',
    page: page.value,
    pageSize,
    q: debouncedQ.value || undefined
  })),
  default: () => ({ items: [], total: 0, page: 1, pageSize })
})

const images = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

/** Each image is a radio card: arrow keys move the selection, Enter or double-click picks it. */
const imageItems = computed(() =>
  images.value.map((image) => ({ value: image.url, label: image.name }))
)

const selected = ref<string | undefined>(props.current ?? undefined)
const externalUrl = ref('')
const storageReady = computed(() => !storage.value || storage.value.state === 'ready')

const urlSchema = z.url({ protocol: /^https?$/, error: 'Enter a full URL starting with https://' })

/** Inline error for the external URL, once something was typed. */
const externalUrlError = computed(() => {
  const value = externalUrl.value.trim()

  if (!value) return undefined
  const parsed = urlSchema.safeParse(value)

  return parsed.success ? undefined : parsed.error.issues[0]?.message
})

const storageActions = computed<ButtonProps[]>(() =>
  canConfigureStorage.value
    ? [{ label: 'Storage settings', to: '/settings/storage', variant: 'outline', size: 'xs' }]
    : []
)

const storageHelp = computed(() =>
  canConfigureStorage.value
    ? 'Configure file storage to upload images.'
    : 'An owner or admin needs to configure file storage before images can be uploaded.'
)

/** Picking from the library clears a typed URL (the URL wins when both are set). */
function onSelect(url: string) {
  selected.value = url
  externalUrl.value = ''
}

async function onUploaded(files: FileDto[]) {
  if (!files.length) return
  q.value = ''
  page.value = 1
  await refresh()
  const last = files.at(-1)

  if (last) onSelect(last.url)
}

const choice = computed(() => {
  const url = externalUrl.value.trim()

  if (url) return externalUrlError.value ? null : url

  return selected.value ?? null
})

function choose() {
  if (choice.value) emit('close', choice.value)
}
</script>

<template>
  <UModal
    :title="title"
    description="Images are served from your storage bucket, so they load in every inbox."
    :ui="{ content: 'sm:max-w-xl', body: 'space-y-4' }"
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <FilesUploadZone
        v-if="storageReady && canUpload"
        :accept="IMAGE_ACCEPT"
        :max-file-size-mb="storage?.maxFileSizeMb ?? 0"
        label="Drop images here or click to upload"
        description="PNG, JPG, GIF, WebP or SVG."
        compact
        @complete="onUploaded"
      />
      <UAlert
        v-else-if="canUpload"
        color="warning"
        icon="i-lucide-triangle-alert"
        title="Uploads are unavailable"
        :description="storage?.message ?? storageHelp"
        :actions="storageActions"
      />

      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search images…"
        size="sm"
        class="w-full"
        aria-label="Search images"
      />

      <div
        v-if="status === 'pending' && !images.length"
        class="grid grid-cols-3 sm:grid-cols-4 gap-2"
        aria-busy="true"
      >
        <USkeleton v-for="i in 8" :key="i" class="aspect-square w-full rounded-lg" />
      </div>
      <URadioGroup
        v-else-if="images.length"
        :model-value="selected"
        :items="imageItems"
        variant="card"
        indicator="hidden"
        color="primary"
        size="sm"
        aria-label="Images"
        class="max-h-[min(50vh,420px)] overflow-y-auto p-1 -m-1"
        :ui="{
          fieldset: 'grid grid-cols-3 sm:grid-cols-4 gap-2',
          item: 'min-w-0 p-1.5 cursor-pointer',
          wrapper: 'min-w-0 w-full gap-1.5',
          label: 'w-full min-w-0 font-normal'
        }"
        @update:model-value="onSelect"
        @dblclick="choose"
        @keydown.enter.prevent="choose"
      >
        <template #label="{ item }">
          <span class="block aspect-square w-full rounded-md bg-elevated/50 overflow-hidden">
            <img
              :src="String(item.value)"
              alt=""
              loading="lazy"
              class="size-full object-contain p-1"
            />
          </span>
          <span class="block truncate text-xs text-muted">{{ item.label }}</span>
        </template>
      </URadioGroup>
      <EmptyState
        v-else
        :variant="debouncedQ ? 'no-results' : 'first-run'"
        icon="i-lucide-image"
        :title="debouncedQ ? 'No images match your search' : 'No images yet'"
        :description="
          debouncedQ
            ? 'Try another name.'
            : canUpload
              ? 'Upload an image above to use it in this template.'
              : 'Images uploaded by your team appear here.'
        "
        compact
      />

      <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="image" />

      <UFormField
        label="Or use an image URL"
        name="url"
        :error="externalUrlError"
        help="Linked images load from their own host."
      >
        <UInput
          v-model="externalUrl"
          type="url"
          placeholder="https://…"
          class="w-full"
          @keydown.enter.prevent="choose"
        />
      </UFormField>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton label="Use image" :disabled="!choice" @click="choose" />
    </template>
  </UModal>
</template>
