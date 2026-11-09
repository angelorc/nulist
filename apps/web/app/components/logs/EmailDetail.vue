<script setup lang="ts">
import type { MessageKind } from '#shared/types/domain'
import type { EmailLogDetail } from '#shared/types/logs'
import type { DetailRow } from './DetailList.vue'

const KIND_LABELS: Record<MessageKind, string> = {
  broadcast: 'Broadcast',
  transactional: 'Transactional',
  system: 'System'
}

const props = defineProps<{ message: EmailLogDetail }>()

const { dateTime, number } = useFormat()
const { can } = useOrganization()

const tabs = [
  { label: 'Preview', value: 'preview', slot: 'preview' as const, icon: 'i-lucide-eye' },
  { label: 'Text', value: 'text', slot: 'text' as const, icon: 'i-lucide-align-left' },
  { label: 'Details', value: 'details', slot: 'details' as const, icon: 'i-lucide-list' }
]

/** Links open in a new tab; the frame is sandboxed (no scripts, no same-origin access). */
const srcdoc = computed(() =>
  props.message.html ? `<base target="_blank">${props.message.html}` : ''
)

const when = (value: string | null) => (value ? dateTime(value) : null)

/** Related records link to their pages only when the member can open them. */
const identity = computed<DetailRow[]>(() => {
  const m = props.message

  return [
    { label: 'Message ID', value: m.id, copy: true },
    { label: 'Provider ID', value: m.providerMessageId, copy: true },
    { label: 'Kind', value: KIND_LABELS[m.kind] },
    { label: 'From', value: m.fromEmail, mono: true },
    { label: 'To', value: m.toEmail, mono: true },
    { label: 'Reply-to', value: m.replyTo, mono: true },
    m.broadcast
      ? {
          label: 'Broadcast',
          value: m.broadcast.name,
          to: can({ broadcast: ['read'] }) ? `/broadcasts/${m.broadcast.id}` : undefined
        }
      : {
          label: 'Template',
          value: m.template?.name ?? null,
          to: m.template && can({ template: ['read'] }) ? `/templates/${m.template.id}` : undefined
        },
    {
      label: 'Contact',
      value: m.contact
        ? [m.contact.firstName, m.contact.lastName].filter(Boolean).join(' ') || m.contact.email
        : null,
      to: m.contact && can({ contact: ['read'] }) ? `/contacts/${m.contact.id}` : undefined
    },
    { label: 'Idempotency key', value: m.idempotencyKey, copy: true },
    { label: 'Workflow run', value: m.runId, copy: true }
  ]
})

const timing = computed<DetailRow[]>(() => {
  const m = props.message

  return [
    { label: 'Created', value: when(m.createdAt) },
    ...(m.scheduledAt ? [{ label: 'Scheduled for', value: when(m.scheduledAt) }] : []),
    { label: 'Sent', value: when(m.sentAt) },
    { label: 'Delivered', value: when(m.deliveredAt) },
    { label: 'First open', value: when(m.openedAt) },
    { label: 'First click', value: when(m.clickedAt) },
    { label: 'Opens / clicks', value: `${number(m.openCount)} / ${number(m.clickCount)}` }
  ]
})

const tags = computed(() => Object.entries(props.message.tags ?? {}))
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="message.error"
      color="error"
      icon="i-lucide-circle-alert"
      :title="message.status === 'suppressed' ? 'Not sent' : 'Delivery problem'"
      :description="message.error"
    />

    <section aria-labelledby="timeline-title">
      <h3 id="timeline-title" class="text-sm font-semibold text-highlighted mb-3">Timeline</h3>
      <LogsEventTimeline
        :created-at="message.createdAt"
        :scheduled-at="message.scheduledAt"
        :status="message.status"
        :error="message.error"
        :events="message.events"
      />
    </section>

    <UTabs :items="tabs" variant="link" size="sm" default-value="preview" :ui="{ content: 'pt-4' }">
      <template #preview>
        <div v-if="message.html" class="space-y-3">
          <UAlert
            v-if="message.htmlSource === 'broadcast'"
            icon="i-lucide-info"
            description="Rendered from the broadcast for this recipient. Unsubscribe and preference links are placeholders."
          />
          <iframe
            :srcdoc="srcdoc"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerpolicy="no-referrer"
            loading="lazy"
            :title="`Preview of ${message.subject}`"
            class="w-full h-[560px] rounded-md ring ring-default bg-white"
          />
        </div>
        <EmptyState
          v-else
          icon="i-lucide-file-x"
          title="No HTML stored"
          description="This email has no HTML body to preview."
          compact
        />
      </template>

      <template #text>
        <pre
          v-if="message.text"
          tabindex="0"
          role="region"
          aria-label="Plain-text body"
          class="text-[13px] leading-6 font-mono whitespace-pre-wrap break-words bg-elevated/60 ring ring-default rounded-md p-3 max-h-[560px] overflow-auto"
          >{{ message.text }}</pre>
        <EmptyState
          v-else
          icon="i-lucide-file-x"
          title="No plain-text version"
          description="This email was sent as HTML only."
          compact
        />
      </template>

      <template #details>
        <div class="space-y-5">
          <LogsDetailList :rows="identity" />
          <LogsDetailList :rows="timing" />

          <div v-if="tags.length" class="space-y-2">
            <h4 class="text-[13px] font-medium text-highlighted">Tags</h4>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="[key, value] in tags"
                :key="key"
                :label="`${key}: ${value}`"
                variant="outline"
                class="font-mono"
              />
            </div>
          </div>

          <div v-if="message.variables && Object.keys(message.variables).length" class="space-y-2">
            <h4 class="text-[13px] font-medium text-highlighted">Variables</h4>
            <JsonBlock :value="message.variables" label="Variables" max-height="16rem" />
          </div>
        </div>
      </template>
    </UTabs>
  </div>
</template>
