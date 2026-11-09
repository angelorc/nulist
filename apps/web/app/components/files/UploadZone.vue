<script setup lang="ts">
import { z } from 'zod'
import { FILE_ACCEPT, fileUploadResultSchema } from '#shared/schemas/files'
import type { FileDto } from '#shared/schemas/files'
import { ACTIVE_ORGANIZATION_HEADER } from '#shared/schemas/organization'

/**
 * Drag & drop / pick / paste uploader for the file manager, built on UFileUpload (an area, or
 * its default slot rendering a button). Files are uploaded as soon as they are added
 * (3 in parallel) with per-file progress. Callers pass `disabled` when the member may not
 * upload (`file:create`).
 */
interface UploadTask {
  id: number
  name: string
  size: number
  progress: number
  state: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
}

const props = withDefaults(
  defineProps<{
    accept?: string
    /** Client-side pre-check (0 = unlimited); the server enforces the real limit. */
    maxFileSizeMb?: number
    variant?: 'area' | 'button'
    label?: string
    description?: string
    disabled?: boolean
    compact?: boolean
  }>(),
  {
    accept: FILE_ACCEPT,
    maxFileSizeMb: 0,
    variant: 'area',
    label: 'Drop files here or click to browse',
    description: 'PNG, JPG, GIF, WebP, SVG or PDF. Files upload automatically.'
  }
)

const emit = defineEmits<{ uploaded: [file: FileDto]; complete: [files: FileDto[]] }>()

const CONCURRENCY = 3
const notify = useNotify()
const { organization } = useOrganization()
const { bytes } = useFormat()
const selection = ref<File[]>([])
const tasks = ref<UploadTask[]>([])
const fileUpload = useTemplateRef('fileUpload')

const busy = computed(() =>
  tasks.value.some((t) => t.state === 'queued' || t.state === 'uploading')
)

let sequence = 0

// UFileUpload fills the model from the dialog and from drops; every batch is uploaded right
// away and the model is cleared so the same file can be picked again.
watch(selection, (files) => {
  if (!files.length) return
  const batch = [...files]
  selection.value = []
  void upload(batch)
})

/** Opens the system file dialog. */
function open() {
  if (props.disabled) return
  fileUpload.value?.inputRef?.click()
}

function removeTask(id: number) {
  tasks.value = tasks.value.filter((t) => t.id !== id)
}

/** Error body of the API (h3 error JSON: `message`, and `data.message` from domain errors). */
const errorBodySchema = z.object({
  message: z.string().optional(),
  data: z.object({ message: z.string().optional() }).optional()
})

type ErrorBody = z.infer<typeof errorBodySchema>

function errorMessage(body: ErrorBody | null, status: number): string {
  if (status === 0) return 'Network error. Check your connection and try again.'

  if (status === 413) return 'The file is too large.'

  // 403 `forbidden` explains that the member's role does not allow uploads.
  return body?.data?.message ?? body?.message ?? `Upload failed (${status})`
}

function send(file: File, task: UploadTask): Promise<FileDto | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.setRequestHeader('accept', 'application/json')

    // XHR bypasses $fetch: send the tab's organization so a switch in another tab
    // gets 409 `organization_changed` instead of uploading into the other organization.
    if (organization.value) xhr.setRequestHeader(ACTIVE_ORGANIZATION_HEADER, organization.value.id)
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable)
        task.progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = fileUploadResultSchema.safeParse(xhr.response)
        const uploaded = body.success ? (body.data.items[0] ?? null) : null

        if (uploaded) {
          task.progress = 100
          task.state = 'done'

          return resolve(uploaded)
        }

        task.state = 'error'
        task.error = (body.success && body.data.errors[0]?.message) || 'Upload failed'

        return resolve(null)
      }

      const body = errorBodySchema.safeParse(xhr.response)
      task.state = 'error'
      task.error = errorMessage(body.success ? body.data : null, xhr.status)
      resolve(null)
    })

    xhr.addEventListener('error', () => {
      task.state = 'error'
      task.error = errorMessage(null, 0)
      resolve(null)
    })

    const form = new FormData()
    form.append('file', file, file.name)
    task.state = 'uploading'
    xhr.send(form)
  })
}

/** Uploads files (also used for paste/drop handled by the parent). */
async function upload(files: File[]): Promise<FileDto[]> {
  if (props.disabled || !files.length) return []
  const limit = props.maxFileSizeMb * 1024 * 1024

  const queue = files.map((file) => {
    // Reactive, so progress updates made through `task` reach the list.
    const task = reactive<UploadTask>({
      id: ++sequence,
      name: file.name || 'pasted-image.png',
      size: file.size,
      progress: 0,
      state: 'queued'
    })

    tasks.value.push(task)

    if (limit && file.size > limit) {
      task.state = 'error'
      task.error = `Larger than ${props.maxFileSizeMb} MB`
    }

    return { file, task }
  })

  const uploaded: FileDto[] = []
  const pending = [...queue]

  /** Takes the next queued file until none is left (CONCURRENCY workers share the queue). */
  const worker = async (): Promise<void> => {
    const item = pending.shift()

    if (!item) return

    const result = item.task.state === 'error' ? null : await send(item.file, item.task)

    if (result) {
      uploaded.push(result)
      emit('uploaded', result)
      const id = item.task.id
      setTimeout(() => removeTask(id), 2500)
    }

    return worker()
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  for (const { task } of queue.filter((q) => q.task.state === 'error')) {
    notify.error(`Couldn't upload ${task.name}`, undefined, { description: task.error })
  }

  const [first] = uploaded

  if (first) {
    notify.success(
      uploaded.length === 1 ? `Uploaded ${first.name}` : `${uploaded.length} files uploaded`
    )
  }

  emit('complete', uploaded)

  return uploaded
}

function onReject(files: File[]) {
  for (const file of files) {
    notify.error(`Couldn't upload ${file.name}`, undefined, {
      description: 'This file type is not supported.'
    })
  }
}

function taskIcon(task: UploadTask): string {
  if (task.state === 'done') return 'i-lucide-circle-check'

  return task.state === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-file-up'
}

function taskIconClass(task: UploadTask): string {
  if (task.state === 'done') return 'text-success'

  return task.state === 'error' ? 'text-error' : 'text-muted'
}

function taskStatus(task: UploadTask): string {
  switch (task.state) {
    case 'error':
      return 'Failed'
    case 'done':
      return 'Uploaded'
    case 'queued':
      return 'Waiting'
    default:
      return `${task.progress}% · ${bytes(task.size)}`
  }
}

defineExpose({ upload, open, busy })
</script>

<template>
  <div class="flex flex-col gap-2">
    <UFileUpload
      v-if="variant === 'area'"
      ref="fileUpload"
      v-model="selection"
      multiple
      :accept="accept"
      :preview="false"
      :disabled="disabled"
      icon="i-lucide-cloud-upload"
      :label="label"
      :description="description"
      class="w-full"
      :ui="{
        base: [
          'bg-elevated/30 hover:bg-elevated/60 transition-colors duration-150',
          'data-[dragging=true]:bg-primary/5 data-[dragging=true]:border-primary',
          compact ? 'min-h-24 p-3' : 'min-h-36'
        ],
        label: 'text-sm font-medium text-highlighted',
        description: 'text-[13px] text-muted'
      }"
      @reject="onReject"
    />
    <UFileUpload
      v-else
      ref="fileUpload"
      v-slot="{ open: pick }"
      v-model="selection"
      multiple
      :accept="accept"
      :preview="false"
      :dropzone="false"
      :interactive="false"
      :disabled="disabled"
      @reject="onReject"
    >
      <UButton
        :label="label"
        icon="i-lucide-upload"
        variant="outline"
        size="sm"
        :loading="busy"
        :disabled="disabled"
        @click="pick()"
      />
    </UFileUpload>

    <TransitionGroup
      v-if="tasks.length"
      tag="ul"
      class="flex flex-col gap-1"
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
      aria-label="Uploads"
      aria-live="polite"
    >
      <li
        v-for="task in tasks"
        :key="task.id"
        class="flex items-center gap-3 rounded-md ring ring-default bg-default px-3 py-2"
      >
        <UIcon :name="taskIcon(task)" class="size-4 shrink-0" :class="taskIconClass(task)" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[13px] font-medium text-highlighted truncate">
              {{ task.name }}
            </p>
            <span class="text-xs text-muted tabular-nums shrink-0">{{ taskStatus(task) }}</span>
          </div>
          <p v-if="task.error" class="text-xs text-error truncate mt-0.5">
            {{ task.error }}
          </p>
          <UProgress
            v-else-if="task.state !== 'done'"
            :model-value="task.state === 'queued' ? 0 : task.progress"
            size="xs"
            class="mt-1.5"
            :aria-label="`Uploading ${task.name}`"
          />
        </div>
        <UButton
          v-if="task.state === 'error'"
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          :aria-label="`Dismiss ${task.name}`"
          @click="removeTask(task.id)"
        />
      </li>
    </TransitionGroup>
  </div>
</template>
