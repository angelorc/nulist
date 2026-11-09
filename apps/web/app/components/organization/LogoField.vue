<script setup lang="ts">
import { IMAGE_ACCEPT } from '#shared/schemas/files'
import type { FileDto, StorageStatus } from '#shared/schemas/files'
import { organizationLogoSchema } from '#shared/schemas/organization'
import type { OrganizationSummary } from '#shared/types/domain'

/**
 * The organization's logo: preview, upload to the file manager (needs file
 * storage and `file:create`), a pasted URL otherwise, and removal. Every
 * change is saved right away (PATCH /api/organization).
 */
const props = defineProps<{
  organization: OrganizationSummary
  /** `organization:update`. */
  canEdit: boolean
}>()

const emit = defineEmits<{ updated: [organization: OrganizationSummary] }>()

const { can } = useOrganization()
const canUseFiles = computed(() => props.canEdit && can({ file: ['create'] }))

// Client-only: the template reads `storage` and `storageError`, never the status, so the
// server render and the hydration render agree (the fetch starts before hydration renders).
const { data: storage, error: storageError } = useFetch<StorageStatus>('/api/files/status', {
  server: false,
  lazy: true,
  immediate: canUseFiles.value
})

/** Storage status still unknown for a member who could upload. */
const storageLoading = computed(() => canUseFiles.value && !storage.value && !storageError.value)

const canUpload = computed(() => canUseFiles.value && storage.value?.state === 'ready')

/**
 * A pasted URL replaces the upload when files are out of reach: the role cannot upload, or
 * storage is known not to be ready. Nothing shows while the storage status loads.
 */
const showUrlField = computed(() => props.canEdit && !canUpload.value && !storageLoading.value)
const logoUrl = ref('')
const logoUrlError = ref<string | null>(null)

const { run: saveLogo, pending } = useApiAction(
  (logo: string | null) =>
    $fetch<OrganizationSummary>('/api/organization', { method: 'PATCH', body: { logo } }),
  {
    success: (organization) => (organization.logo ? 'Logo updated' : 'Logo removed'),
    error: 'Could not update the logo'
  }
)

async function apply(logo: string | null) {
  const updated = await saveLogo(logo)

  if (updated) emit('updated', updated)
}

async function onUploaded(file: FileDto) {
  await apply(file.url)
}

async function onUseUrl() {
  const parsed = organizationLogoSchema.safeParse(logoUrl.value.trim())
  logoUrlError.value = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid URL')

  if (!parsed.success || !parsed.data) return
  await apply(parsed.data)
  logoUrl.value = ''
}

const storageHint = computed(() => {
  if (!props.canEdit) return null

  if (!can({ file: ['create'] })) return 'Your role cannot upload files: paste the URL of an image.'

  if (!storage.value) return null

  return storage.value.state === 'ready'
    ? 'PNG, JPG, GIF, WebP or SVG. A square image works best.'
    : 'File storage is not set up: paste the URL of an image instead.'
})
</script>

<template>
  <div class="flex items-start gap-4">
    <AppOrganizationAvatar :name="organization.name" :logo="organization.logo" size="lg" />
    <div class="min-w-0 flex-1 space-y-3">
      <div
        v-if="canEdit && (canUpload || organization.logo)"
        class="flex flex-wrap items-center gap-2"
      >
        <FilesUploadZone
          v-if="canUpload"
          variant="button"
          :accept="IMAGE_ACCEPT"
          :label="organization.logo ? 'Replace logo' : 'Upload logo'"
          :disabled="pending"
          @uploaded="onUploaded"
        />
        <UButton
          v-if="organization.logo"
          label="Remove"
          icon="i-lucide-trash"
          variant="ghost"
          :loading="pending"
          @click="apply(null)"
        />
      </div>
      <USkeleton v-else-if="storageLoading" class="h-8 w-32" />
      <UFormField
        v-if="showUrlField"
        label="Image URL"
        name="logoUrl"
        :error="logoUrlError ?? undefined"
      >
        <UFieldGroup class="w-full">
          <UInput
            v-model="logoUrl"
            type="url"
            placeholder="https://example.com/logo.png"
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1"
            @keydown.enter.prevent="onUseUrl"
          />
          <UButton
            label="Use URL"
            variant="outline"
            :disabled="!logoUrl.trim()"
            :loading="pending"
            @click="onUseUrl"
          />
        </UFieldGroup>
      </UFormField>
      <p v-if="storageHint" class="text-[13px] text-muted">
        {{ storageHint }}
        <ULink
          v-if="
            canUseFiles && storage && storage.state !== 'ready' && can({ settings: ['update'] })
          "
          to="/settings/storage"
          class="font-medium text-primary"
        >
          Set up storage
        </ULink>
      </p>
      <p v-if="!canEdit" class="text-[13px] text-muted">
        Only owners and admins can change the logo.
      </p>
    </div>
  </div>
</template>
