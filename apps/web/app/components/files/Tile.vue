<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { isImageType } from '#shared/schemas/files'
import type { FileDto } from '#shared/schemas/files'

/**
 * A file in the manager grid: the whole card opens the file in a new tab; copying the URL and
 * the row menu sit above the card link.
 */
const props = defineProps<{ file: FileDto }>()
const emit = defineEmits<{ delete: [file: FileDto] }>()

const { bytes } = useFormat()
const { can } = useOrganization()
const notify = useNotify()
const { copy } = useClipboard({ legacy: true })
const isImage = computed(() => isImageType(props.file.contentType))
const extension = computed(() => (props.file.name.split('.').pop() ?? '').toUpperCase())
const broken = ref(false)

/** From the menu, which closes on select: confirm with a toast (the icon button shows a check). */
async function copyUrl() {
  await copy(props.file.url)
  notify.success('URL copied')
}

const items = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [
    [
      { label: 'Copy URL', icon: 'i-lucide-link', onSelect: copyUrl },
      {
        label: 'Open in new tab',
        icon: 'i-lucide-external-link',
        to: props.file.url,
        target: '_blank'
      },
      {
        label: 'Download',
        icon: 'i-lucide-download',
        to: props.file.url,
        target: '_blank',
        download: props.file.name
      }
    ]
  ]

  if (can({ file: ['delete'] })) {
    groups.push([
      {
        label: 'Delete',
        icon: 'i-lucide-trash',
        color: 'error',
        onSelect: () => emit('delete', props.file)
      }
    ])
  }

  return groups
})
</script>

<template>
  <UPageCard
    :to="file.url"
    target="_blank"
    :title="file.name"
    variant="outline"
    class="group h-full"
    :ui="{
      root: 'overflow-hidden hover:ring-accented',
      container: 'min-w-0 p-0 sm:p-0 gap-0 lg:flex',
      wrapper: 'min-w-0',
      header: 'relative mb-0 w-full aspect-[4/3] bg-elevated/50 border-b border-default',
      body: 'flex items-center gap-2 w-full min-w-0 ps-3 pe-2 py-2'
    }"
  >
    <template #header>
      <img
        v-if="isImage && !broken"
        :src="file.url"
        alt=""
        loading="lazy"
        decoding="async"
        class="absolute inset-0 size-full object-contain p-3"
        @error="broken = true"
      />
      <span v-else class="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <UIcon
          :name="isImage ? 'i-lucide-image-off' : 'i-lucide-file-text'"
          class="size-7 text-muted"
        />
        <span class="text-xs font-medium text-muted">{{ extension }}</span>
      </span>

      <CopyButton
        :value="file.url"
        :label="`URL of ${file.name}`"
        variant="outline"
        class="absolute top-2 end-2 z-10 transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100"
      />
    </template>

    <template #body>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-medium text-highlighted truncate" :title="file.name">
          {{ file.name }}
        </p>
        <p class="text-xs text-muted tabular-nums truncate">
          {{ bytes(file.size) }} · <TimeAgo :date="file.createdAt" />
        </p>
      </div>
      <UDropdownMenu :items="items" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis"
          variant="ghost"
          size="sm"
          class="relative z-10"
          :aria-label="`Actions for ${file.name}`"
        />
      </UDropdownMenu>
    </template>
  </UPageCard>
</template>
