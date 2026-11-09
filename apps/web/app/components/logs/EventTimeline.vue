<script setup lang="ts">
import { emailEventDetailsSchema } from '#shared/schemas/logs'
import type { EmailEventType, JsonObject, MessageStatus } from '#shared/types/domain'
import type { EmailEventItem } from '#shared/types/logs'
import type { TimelineItem } from '@nuxt/ui'

const props = defineProps<{
  createdAt: string
  scheduledAt: string | null
  status: MessageStatus
  error: string | null
  events: EmailEventItem[]
}>()

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error'

/** One step of the delivery timeline, as a UTimeline item. */
type TimelineEntry = {
  key: string
  title: string
  icon: string
  tone: Tone
  at: string | null
  detail?: string
  times?: string[]
  data?: JsonObject
  pending?: boolean
  ui?: TimelineItem['ui']
}

const { dateTime } = useFormat()

/** How each provider event reads in the timeline. */
function describe(event: EmailEventItem): Omit<TimelineEntry, 'key' | 'at' | 'data'> {
  const d = emailEventDetailsSchema.parse(event.data)

  const map: Record<EmailEventType, () => Omit<TimelineEntry, 'key' | 'at' | 'data'>> = {
    send: () => ({
      title: 'Sent',
      icon: 'i-lucide-send',
      tone: 'primary',
      detail: d.provider && `Accepted by ${d.provider.toUpperCase()}`
    }),
    delivery: () => ({
      title: 'Delivered',
      icon: 'i-lucide-mail-check',
      tone: 'success',
      detail: d.smtpResponse
    }),
    open: () => ({
      title: 'Opened',
      icon: 'i-lucide-eye',
      tone: 'primary',
      detail: d.userAgent
    }),
    click: () => ({
      title: 'Clicked',
      icon: 'i-lucide-mouse-pointer-click',
      tone: 'primary',
      detail: d.link ?? d.click?.link
    }),
    bounce: () => {
      const type = d.bounceType

      return {
        title: type === 'Transient' ? 'Soft bounce' : 'Bounced',
        icon: 'i-lucide-circle-x',
        tone: 'error',
        detail:
          [type, d.bounceSubType].filter(Boolean).join(' · ') +
          (d.diagnosticCode ? ` — ${d.diagnosticCode}` : '')
      }
    },
    complaint: () => ({
      title: 'Marked as spam',
      icon: 'i-lucide-shield-alert',
      tone: 'error',
      detail: d.feedbackType ?? d.complaintFeedbackType
    }),
    reject: () => ({
      title: 'Rejected by provider',
      icon: 'i-lucide-ban',
      tone: 'error',
      detail: d.reason
    }),
    delivery_delay: () => ({
      title: 'Delivery delayed',
      icon: 'i-lucide-clock-alert',
      tone: 'warning',
      detail: d.delayType
    }),
    rendering_failure: () => ({
      title: 'Rendering failed',
      icon: 'i-lucide-file-x',
      tone: 'error',
      detail: d.errorMessage
    }),
    unsubscribe: () => ({
      title: 'Unsubscribed',
      icon: 'i-lucide-user-minus',
      tone: 'neutral',
      detail: d.source && `Via ${d.source.replace(/[-_]/g, ' ')}`
    }),
    failed: () => ({
      title: 'Failed',
      icon: 'i-lucide-triangle-alert',
      tone: 'error',
      detail: d.error
    })
  }

  return map[event.type]()
}

/** Indicator look per tone (semantic colors, DESIGN.md §2); waiting steps get a dashed ring. */
const TONE: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted ring ring-default',
  primary: 'bg-primary/10 text-primary ring ring-primary/25',
  success: 'bg-success/10 text-success ring ring-success/25',
  warning: 'bg-warning/10 text-warning ring ring-warning/25',
  error: 'bg-error/10 text-error ring ring-error/25'
}

const PENDING_INDICATOR = 'bg-default text-muted ring-0 border border-dashed border-accented'

/** The indicator and title colors of an entry. */
function look(entry: TimelineEntry): TimelineItem['ui'] {
  if (entry.pending) return { indicator: PENDING_INDICATOR, title: 'text-muted' }

  return { indicator: TONE[entry.tone], title: entry.tone === 'error' ? 'text-error' : undefined }
}

const entries = computed<TimelineEntry[]>(() => {
  const list: TimelineEntry[] = [
    { key: 'queued', title: 'Queued', icon: 'i-lucide-inbox', tone: 'neutral', at: props.createdAt }
  ]

  if (props.scheduledAt) {
    list.push({
      key: 'scheduled',
      title: props.status === 'scheduled' ? 'Scheduled' : 'Scheduled for',
      icon: 'i-lucide-calendar-clock',
      tone: 'neutral',
      at: props.scheduledAt,
      pending: props.status === 'scheduled'
    })
  }

  for (const event of props.events) {
    const previous = list.at(-1)

    // Repeated opens collapse into one entry with every timestamp.
    if (event.type === 'open' && previous?.key.startsWith('open-')) {
      previous.times = [...(previous.times ?? [previous.at ?? '']), event.occurredAt]
      previous.title = `Opened ${previous.times.length} times`
      continue
    }

    list.push({
      key: `${event.type}-${event.id}`,
      at: event.occurredAt,
      data: event.data,
      ...describe(event)
    })
  }

  if (props.status === 'suppressed') {
    list.push({
      key: 'suppressed',
      title: 'Not sent: address suppressed',
      icon: 'i-lucide-ban',
      tone: 'neutral',
      at: null,
      detail: props.error ?? undefined
    })
  } else if (
    ['queued', 'sending', 'sent'].includes(props.status) &&
    !props.events.some((e) => e.type === 'delivery')
  ) {
    list.push({
      key: 'pending',
      title: props.status === 'sent' ? 'Waiting for delivery confirmation' : 'Waiting to be sent',
      icon: 'i-lucide-loader',
      tone: 'neutral',
      at: null,
      pending: true
    })
  }

  for (const entry of list) entry.ui = look(entry)

  return list
})

/** Whether an entry carries provider data worth disclosing. */
function hasData(entry: TimelineEntry): boolean {
  return entry.data !== undefined && Object.keys(entry.data).length > 0
}
</script>

<template>
  <UTimeline
    :items="entries"
    size="xs"
    color="neutral"
    :ui="{
      separator: 'bg-accented',
      date: 'text-muted tabular-nums',
      description: 'text-[13px]'
    }"
  >
    <template #date="{ item }">
      <time v-if="item.at" :datetime="item.at">{{ dateTime(item.at) }}</time>
    </template>

    <template #description="{ item }">
      <p
        v-if="item.detail"
        class="break-all"
        :class="item.key.startsWith('click') && 'font-mono text-xs'"
      >
        {{ item.detail }}
      </p>
      <ul v-if="item.times && item.times.length > 1" class="mt-1 text-xs tabular-nums space-y-0.5">
        <li v-for="time in item.times.slice(1)" :key="time">
          Again <time :datetime="time">{{ dateTime(time) }}</time>
        </li>
      </ul>
      <UCollapsible v-if="hasData(item)" class="mt-1" :ui="{ content: 'pt-2' }">
        <template #default="{ open }">
          <UButton
            label="Event data"
            :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="link"
            size="xs"
            class="px-0"
          />
        </template>
        <template #content>
          <JsonBlock :value="item.data" label="Event data" max-height="16rem" />
        </template>
      </UCollapsible>
    </template>
  </UTimeline>
</template>
