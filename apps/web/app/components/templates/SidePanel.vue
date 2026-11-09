<script setup lang="ts">
import { TemplatesImagePickerModal } from '#components'
import { IMAGE_ACCEPT } from '#shared/schemas/files'
import type { FileDto, StorageStatus } from '#shared/schemas/files'
import type { Paginated } from '#shared/types/domain'

/**
 * Editor side panel: Liquid variables (copy, or insert at the cursor) and an image picker
 * backed by the organization's file manager. Inserting needs `template:update`, browsing
 * `file:read`, uploading `file:create` and configuring storage `settings:update`.
 */
defineProps<{ canInsertText?: boolean }>()

const emit = defineEmits<{
  'insert-image': [url: string, alt: string]
  'insert-text': [text: string]
}>()

const { can } = useOrganization()
const canInsert = computed(() => can({ template: ['update'] }))
const canUpload = computed(() => can({ file: ['create'] }))
const canConfigureStorage = computed(() => can({ settings: ['update'] }))
const showImages = computed(() => canInsert.value && can({ file: ['read'] }))

/** The Liquid tag of a documented variable (`<key>` placeholders become `key`). */
function tagFor(name: string) {
  return `{{ ${name.replace('<key>', 'key')} }}`
}

/** File name without its extension, as default alt text. */
function altFor(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

// Images ---------------------------------------------------------------------
const { data: storage } = useFetch<StorageStatus>('/api/files/status', {
  key: 'files-status-panel',
  immediate: showImages.value
})

const {
  data: recent,
  status,
  refresh
} = useFetch<Paginated<FileDto>>('/api/files', {
  key: 'template-panel-images',
  immediate: showImages.value,
  query: { type: 'image', pageSize: 9 },
  default: () => ({ items: [], total: 0, page: 1, pageSize: 9 })
})

const storageReady = computed(() => !storage.value || storage.value.state === 'ready')

async function onUploaded(files: FileDto[]) {
  await refresh()
  const last = files.at(-1)

  if (last) emit('insert-image', last.url, altFor(last.name))
}

const overlay = useOverlay()
const picker = overlay.create(TemplatesImagePickerModal)

async function browse() {
  const url = await picker.open({ title: 'Insert image' }).result

  if (url) emit('insert-image', url, '')
  await refresh()
}
</script>

<template>
  <div class="flex flex-col divide-y divide-default">
    <section v-if="showImages" class="p-4 space-y-3" aria-labelledby="panel-images">
      <div class="flex items-center justify-between gap-2">
        <h3 id="panel-images" class="text-[13px] font-semibold text-highlighted">Images</h3>
        <UButton
          label="Browse"
          size="xs"
          variant="ghost"
          trailing-icon="i-lucide-arrow-up-right"
          class="-me-1.5"
          @click="browse"
        />
      </div>
      <p class="text-xs text-muted">
        Click an image to insert it{{
          canInsertText ? ' at the cursor' : ' into the selected column'
        }}.
      </p>

      <div
        v-if="status === 'pending' && !recent.items.length"
        class="grid grid-cols-3 gap-1.5"
        aria-busy="true"
      >
        <USkeleton v-for="i in 6" :key="i" class="aspect-square w-full" />
      </div>
      <ul
        v-else-if="recent.items.length"
        class="grid grid-cols-3 gap-1.5"
        aria-label="Recent images"
      >
        <li v-for="image in recent.items" :key="image.id">
          <UTooltip :text="image.name" :delay-duration="400">
            <UButton
              variant="outline"
              block
              class="aspect-square p-1 overflow-hidden"
              :aria-label="`Insert ${image.name}`"
              @click="emit('insert-image', image.url, altFor(image.name))"
            >
              <img :src="image.url" alt="" loading="lazy" class="size-full object-contain" />
            </UButton>
          </UTooltip>
        </li>
      </ul>
      <p v-else class="text-xs text-muted">No images yet.</p>

      <template v-if="canUpload">
        <FilesUploadZone
          v-if="storageReady"
          variant="button"
          label="Upload image"
          :accept="IMAGE_ACCEPT"
          :max-file-size-mb="storage?.maxFileSizeMb ?? 0"
          @complete="onUploaded"
        />
        <p v-else class="text-xs text-muted">
          Uploads need file storage.
          <ULink v-if="canConfigureStorage" to="/settings/storage" class="text-primary">
            Configure storage
          </ULink>
          <template v-else>Ask an owner or admin to configure it.</template>
        </p>
      </template>
    </section>

    <section class="p-4 space-y-3" aria-labelledby="panel-variables">
      <div>
        <h3 id="panel-variables" class="text-[13px] font-semibold text-highlighted">Variables</h3>
        <p class="text-xs text-muted mt-0.5">
          Liquid tags, replaced for every recipient.
          {{ canInsertText && canInsert ? 'Copy one or insert it at the cursor.' : 'Copy one.' }}
        </p>
      </div>
      <ul class="space-y-0.5 -mx-2">
        <li
          v-for="variable in TEMPLATE_VARIABLES"
          :key="variable.name"
          class="group flex items-start gap-1 rounded-md px-2 py-1.5 hover:bg-elevated/60 transition-colors"
        >
          <div class="min-w-0 flex-1">
            <code class="block font-mono text-xs text-highlighted truncate">{{
              tagFor(variable.name)
            }}</code>
            <p class="text-xs text-muted mt-0.5">{{ variable.description }}</p>
          </div>
          <div
            class="flex shrink-0 -my-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100"
          >
            <UTooltip v-if="canInsertText && canInsert" text="Insert at the cursor">
              <UButton
                icon="i-lucide-text-cursor-input"
                size="xs"
                variant="ghost"
                :aria-label="`Insert ${tagFor(variable.name)} at the cursor`"
                @click="emit('insert-text', tagFor(variable.name))"
              />
            </UTooltip>
            <CopyButton :value="tagFor(variable.name)" :label="tagFor(variable.name)" />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
