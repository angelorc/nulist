<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { BroadcastPreview } from '#shared/types/broadcasts'

type Device = 'desktop' | 'mobile'

const DEVICES = [
  { label: 'Desktop', value: 'desktop', icon: 'i-lucide-monitor' },
  { label: 'Mobile', value: 'mobile', icon: 'i-lucide-smartphone' }
] satisfies TabsItem[]

/**
 * Inbox-style preview: sender, subject and preview text above the rendered email
 * in a sandboxed iframe (no scripts) that grows to the email's height.
 */
const props = defineProps<{
  preview: BroadcastPreview | null
  pending?: boolean
  error?: boolean
  fromName?: string | null
  fromEmail?: string | null
  preheader?: string | null
  note?: string
}>()

defineEmits<{ refresh: [] }>()

const device = ref<Device>('desktop')
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const height = ref(640)

const srcdoc = computed(() => {
  const html = props.preview?.html

  if (!html) return ''
  const base = '<base target="_blank">'

  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html
})

function measure() {
  const doc = frame.value?.contentDocument

  if (!doc?.documentElement) return
  height.value = Math.max(480, Math.min(4000, doc.documentElement.scrollHeight))
}

watch(device, () => nextTick(() => setTimeout(measure, 50)))

const sender = computed(() => props.fromName || props.fromEmail || 'Sender')

const issuesTitle = computed(() => {
  const count = props.preview?.issues.length ?? 0

  return count === 1 ? 'The template has 1 issue' : `The template has ${count} issues`
})
</script>

<template>
  <section class="rounded-lg ring ring-default overflow-hidden" aria-label="Email preview">
    <header class="flex items-start gap-3 px-4 py-3 border-b border-default">
      <UAvatar :alt="sender" size="md" class="bg-elevated ring ring-default" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-[13px] text-highlighted truncate">
          <span class="font-semibold">{{ sender }}</span>
          <span v-if="fromName && fromEmail" class="text-muted"> &lt;{{ fromEmail }}&gt;</span>
        </p>
        <p class="text-sm font-medium text-highlighted truncate">
          {{ preview?.subject || 'No subject' }}
        </p>
        <p class="text-xs text-muted truncate">
          {{ preheader || 'No preview text' }}
        </p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <UTabs
          v-model="device"
          :items="DEVICES"
          :content="false"
          size="xs"
          color="neutral"
          aria-label="Preview width"
          :ui="{ label: 'max-sm:sr-only' }"
        />
        <UTooltip text="Refresh preview">
          <UButton
            icon="i-lucide-refresh-cw"
            size="sm"
            variant="ghost"
            :loading="pending"
            aria-label="Refresh preview"
            @click="$emit('refresh')"
          />
        </UTooltip>
      </div>
    </header>

    <UAlert
      v-if="preview?.issues.length"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="issuesTitle"
      class="rounded-none ring-0 border-b border-default"
    >
      <template #description>
        <ul class="list-disc ps-4 space-y-0.5">
          <li v-for="issue in preview.issues" :key="issue">{{ issue }}</li>
        </ul>
      </template>
    </UAlert>

    <div
      class="bg-elevated/40 p-3 sm:p-4 transition-opacity"
      :class="pending && preview && 'opacity-60'"
      :aria-busy="pending"
    >
      <EmptyState
        v-if="error && !preview"
        compact
        variant="error"
        title="Couldn't render the preview"
        description="Check the template and try again."
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          @click="$emit('refresh')"
        />
      </EmptyState>
      <USkeleton v-else-if="!preview" class="w-full h-[480px] rounded-md" />
      <EmptyState
        v-else-if="!preview.html"
        compact
        icon="i-lucide-layout-template"
        title="Nothing to preview yet"
        description="Choose a template to see the email your contacts will receive."
      />
      <div
        v-else
        class="mx-auto transition-[max-width] duration-200"
        :class="device === 'mobile' ? 'max-w-[390px]' : 'max-w-full'"
      >
        <iframe
          ref="frame"
          :srcdoc="srcdoc"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
          :title="`Preview of ${preview.subject || 'the email'}`"
          class="w-full rounded-md ring ring-default bg-white block"
          :style="{ height: `${height}px` }"
          @load="measure"
        />
      </div>
      <p v-if="note" class="mt-2 text-xs text-muted flex items-center gap-1.5">
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        {{ note }}
      </p>
    </div>
  </section>
</template>
