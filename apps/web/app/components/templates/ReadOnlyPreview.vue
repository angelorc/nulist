<script setup lang="ts">
import type { TemplatePreviewResult } from '#shared/schemas/templates'

/**
 * Rendered template with sample data, for members who may read but not edit it
 * (GrapesJS has no read-only mode, so viewers get this instead of the visual editor).
 */
const props = defineProps<{
  mjml: string
  subject?: string
  preheader?: string | null
  device: 'desktop' | 'mobile'
}>()

const body = computed(() => ({
  mjml: props.mjml,
  subject: props.subject ?? '',
  preheader: props.preheader ?? null
}))

const {
  data: preview,
  status,
  error
} = useFetch<TemplatePreviewResult>('/api/templates/preview', {
  key: 'template-read-only-preview',
  method: 'POST',
  body
})

const loading = computed(() => status.value === 'pending')
</script>

<template>
  <section class="flex-1 min-w-0 min-h-0 flex flex-col bg-elevated/40" aria-label="Preview">
    <div
      class="shrink-0 flex items-center gap-2 h-9 px-3 border-b border-default text-xs text-muted"
    >
      <span class="font-medium text-default">Preview</span>
      <span v-if="preview?.subject" class="min-w-0 truncate">· {{ preview.subject }}</span>
      <span class="ms-auto shrink-0 flex items-center gap-1.5 whitespace-nowrap" aria-live="polite">
        <template v-if="loading">
          <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
          Rendering…
        </template>
        <template v-else>Sample data · View only</template>
      </span>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden p-4 flex justify-center">
      <iframe
        v-if="preview?.html"
        :srcdoc="preview.html"
        sandbox="allow-same-origin"
        title="Email preview"
        class="h-full bg-white rounded-md ring ring-default transition-[width] duration-200"
        :style="{ width: device === 'mobile' ? '375px' : '100%' }"
      />
      <EmptyState
        v-else-if="!loading"
        variant="error"
        title="Nothing to preview"
        :description="
          error ? apiErrorMessage(error) : 'This template has MJML issues and cannot be rendered.'
        "
        compact
        class="self-center"
      />
      <USkeleton v-else class="h-full w-full max-w-[640px]" />
    </div>
  </section>
</template>
