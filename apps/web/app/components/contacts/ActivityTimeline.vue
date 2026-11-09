<script setup lang="ts">
import type { TimelineItem } from '@nuxt/ui'
import type { ContactActivityItem, ContactActivityType } from '#shared/types/contacts'

/** Vertical timeline of a contact's events, newest first (DESIGN.md §7). */
const props = defineProps<{ items: ContactActivityItem[] }>()

interface Presentation {
  icon: string
  label: (item: ContactActivityItem) => string
  /** Only meaningful states get color (DESIGN: color carries meaning). */
  tone?: 'success' | 'error' | 'warning' | 'primary'
}

/** A timeline row carrying the event it renders. */
interface ActivityTimelineItem extends TimelineItem {
  activity: ContactActivityItem
}

const PRESENTATION: Record<ContactActivityType, Presentation> = {
  created: { icon: 'i-lucide-user-plus', label: () => 'Contact created' },
  subscribed: { icon: 'i-lucide-list-plus', label: (i) => `Joined ${i.listName ?? 'a list'}` },
  confirmed: {
    icon: 'i-lucide-badge-check',
    label: (i) => `Confirmed subscription to ${i.listName ?? 'a list'}`,
    tone: 'success'
  },
  message: {
    icon: 'i-lucide-mail',
    label: (i) =>
      i.messageKind === 'transactional'
        ? 'Transactional email'
        : i.messageKind === 'system'
          ? 'System email'
          : 'Broadcast email'
  },
  send: { icon: 'i-lucide-send', label: () => 'Sent' },
  delivery: { icon: 'i-lucide-inbox', label: () => 'Delivered', tone: 'success' },
  open: { icon: 'i-lucide-mail-open', label: () => 'Opened', tone: 'primary' },
  click: { icon: 'i-lucide-mouse-pointer-click', label: () => 'Clicked a link', tone: 'primary' },
  bounce: { icon: 'i-lucide-octagon-x', label: () => 'Bounced', tone: 'error' },
  complaint: { icon: 'i-lucide-flag', label: () => 'Marked as spam', tone: 'error' },
  reject: { icon: 'i-lucide-ban', label: () => 'Rejected by the provider', tone: 'error' },
  delivery_delay: { icon: 'i-lucide-clock', label: () => 'Delivery delayed', tone: 'warning' },
  rendering_failure: {
    icon: 'i-lucide-file-warning',
    label: () => 'Rendering failed',
    tone: 'error'
  },
  failed: { icon: 'i-lucide-circle-x', label: () => 'Sending failed', tone: 'error' },
  unsubscribe: {
    icon: 'i-lucide-mail-x',
    label: (i) =>
      i.listName
        ? `Unsubscribed from ${i.listName}`
        : i.messageId
          ? 'Unsubscribed'
          : 'Unsubscribed from all emails'
  }
}

const TONE_CLASS: Record<NonNullable<Presentation['tone']>, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  primary: 'text-primary'
}

function present(item: ContactActivityItem): Presentation {
  return PRESENTATION[item.type] ?? { icon: 'i-lucide-dot', label: () => item.type }
}

const timeline = computed<ActivityTimelineItem[]>(() =>
  props.items.map((activity) => {
    const presentation = present(activity)

    return {
      value: activity.id,
      icon: presentation.icon,
      title: presentation.label(activity),
      ui: { indicator: presentation.tone ? TONE_CLASS[presentation.tone] : undefined },
      activity
    }
  })
)

function isLink(detail: string | null | undefined): detail is string {
  return !!detail && /^https?:\/\//.test(detail)
}

/** Whether an event has a second line (subject, delivery status, detail). */
function hasDetails(item: ContactActivityItem): boolean {
  return !!item.subject || !!(item.type === 'message' && item.messageStatus) || !!item.detail
}
</script>

<template>
  <UTimeline
    :items="timeline"
    size="xs"
    color="neutral"
    :ui="{
      indicator: 'bg-default ring ring-default',
      date: 'text-muted text-xs/5 tabular-nums',
      description: 'text-[13px] space-y-1 mt-0.5'
    }"
  >
    <template #date="{ item }">
      <TimeAgo :date="item.activity.at" />
    </template>
    <template #description="{ item }">
      <template v-if="hasDetails(item.activity)">
        <p v-if="item.activity.subject" class="truncate" :title="item.activity.subject">
          {{ item.activity.subject }}
        </p>
        <StatusBadge
          v-if="item.activity.type === 'message' && item.activity.messageStatus"
          :status="item.activity.messageStatus"
          size="xs"
        />
        <p v-if="item.activity.type === 'created' && item.activity.detail">
          Source: {{ item.activity.detail }}
        </p>
        <p v-else-if="item.activity.detail" class="font-mono text-xs truncate">
          <ULink
            v-if="isLink(item.activity.detail)"
            :to="item.activity.detail"
            target="_blank"
            external
            class="underline-offset-2 hover:underline"
            >{{ item.activity.detail }}</ULink
          >
          <template v-else>
            {{ item.activity.detail }}
          </template>
        </p>
      </template>
    </template>
  </UTimeline>
</template>
