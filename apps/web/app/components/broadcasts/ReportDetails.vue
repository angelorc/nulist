<script setup lang="ts">
import { differenceInSeconds } from 'date-fns'
import type {
  AudienceListOption,
  AudienceSegmentOption,
  BroadcastDetail
} from '#shared/types/broadcasts'

/** Metadata rail of the report: what was sent, to whom, when. */
const props = defineProps<{ broadcast: BroadcastDetail }>()

const { can } = useOrganization()
const canReadTemplate = computed(() => can({ template: ['read'] }))

const { data: lists, status: listsStatus } = useFetch<AudienceListOption[]>('/api/lists', {
  lazy: true,
  server: false,
  default: () => []
})

const { data: segments, status: segmentsStatus } = useFetch<AudienceSegmentOption[]>(
  '/api/segments',
  { lazy: true, server: false, default: () => [] }
)

/** Names resolve on the client; until then (and on the server) show a neutral placeholder. */
const namesReady = computed(
  () => listsStatus.value === 'success' && segmentsStatus.value === 'success'
)

/** Name of a list or segment, `fallback` once names loaded and it is gone. */
function name<T extends { id: string; name: string }>(items: T[], id: string, fallback: string) {
  return items.find((i) => i.id === id)?.name ?? (namesReady.value ? fallback : 'Loading…')
}

const audience = computed(() => {
  const a = props.broadcast.audience

  return {
    include: [
      ...a.listIds.map((id) => ({
        id,
        icon: 'i-lucide-list',
        label: name(lists.value, id, 'Deleted list')
      })),
      ...a.segmentIds.map((id) => ({
        id,
        icon: 'i-lucide-filter',
        label: name(segments.value, id, 'Deleted segment')
      }))
    ],
    exclude: a.excludeListIds.map((id) => ({
      id,
      icon: 'i-lucide-list-x',
      label: name(lists.value, id, 'Deleted list')
    }))
  }
})

const duration = computed(() => {
  const { startedAt, completedAt } = props.broadcast

  if (!startedAt || !completedAt) return null
  const seconds = differenceInSeconds(new Date(completedAt), new Date(startedAt))

  if (seconds < 60) return `${Math.max(1, seconds)} s`

  if (seconds < 3600) return `${Math.round(seconds / 60)} min`

  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`
})

const sender = computed(() =>
  props.broadcast.fromName
    ? `${props.broadcast.fromName} <${props.broadcast.fromEmail}>`
    : props.broadcast.fromEmail
)

const utm = computed(() =>
  props.broadcast.utm.enabled
    ? [
        props.broadcast.utm.source || 'newsletter',
        props.broadcast.utm.medium || 'email',
        props.broadcast.utm.campaign || props.broadcast.defaultCampaign
      ].join(' · ')
    : null
)
</script>

<template>
  <div class="space-y-5">
    <section>
      <h2 class="text-xs font-medium text-muted mb-2">Message</h2>
      <dl class="divide-y divide-default text-[13px]">
        <div class="py-2 space-y-0.5">
          <dt class="text-muted">Subject</dt>
          <dd class="text-highlighted break-words">
            {{ broadcast.subject || 'No subject' }}
          </dd>
        </div>
        <div v-if="broadcast.preheader" class="py-2 space-y-0.5">
          <dt class="text-muted">Preview text</dt>
          <dd class="text-default break-words">
            {{ broadcast.preheader }}
          </dd>
        </div>
        <div class="py-2 space-y-0.5">
          <dt class="text-muted">From</dt>
          <dd class="text-default break-all font-mono text-xs">
            {{ sender || '—' }}
          </dd>
        </div>
        <div v-if="broadcast.replyTo" class="py-2 space-y-0.5">
          <dt class="text-muted">Reply-to</dt>
          <dd class="text-default break-all font-mono text-xs">
            {{ broadcast.replyTo }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Template</dt>
          <dd class="min-w-0 truncate">
            <ULink
              v-if="broadcast.template && canReadTemplate"
              :to="`/templates/${broadcast.template.id}`"
              class="text-primary hover:text-primary hover:underline underline-offset-2"
            >
              {{ broadcast.template.name }}
            </ULink>
            <span v-else-if="broadcast.template" class="text-default">
              {{ broadcast.template.name }}
            </span>
            <span v-else class="text-muted">Deleted</span>
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Topic</dt>
          <dd class="text-default truncate">
            {{ broadcast.topic?.name ?? 'None' }}
          </dd>
        </div>
        <div v-if="utm" class="py-2 space-y-0.5">
          <dt class="text-muted">UTM</dt>
          <dd class="text-default font-mono text-xs break-all">
            {{ utm }}
          </dd>
        </div>
      </dl>
    </section>

    <section>
      <h2 class="text-xs font-medium text-muted mb-2">Audience</h2>
      <ul class="space-y-1.5 text-[13px]">
        <li v-if="!audience.include.length" class="text-muted">No lists or segments</li>
        <li
          v-for="item in audience.include"
          :key="item.id"
          class="flex items-center gap-1.5 text-default min-w-0"
        >
          <UIcon :name="item.icon" class="size-3.5 text-muted shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </li>
        <li
          v-for="item in audience.exclude"
          :key="item.id"
          class="flex items-center gap-1.5 text-muted min-w-0"
        >
          <UIcon :name="item.icon" class="size-3.5 shrink-0" />
          <span class="truncate">Except {{ item.label }}</span>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="text-xs font-medium text-muted mb-2">Timing</h2>
      <dl class="divide-y divide-default text-[13px]">
        <div v-if="broadcast.scheduledAt" class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Scheduled</dt>
          <dd class="text-default tabular-nums">
            <NuxtTime
              :datetime="broadcast.scheduledAt"
              locale="en-GB"
              day="numeric"
              month="short"
              year="numeric"
              hour="2-digit"
              minute="2-digit"
              hour-cycle="h23"
            />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Started</dt>
          <dd class="text-default">
            <TimeAgo :date="broadcast.startedAt" fallback="Not started" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">
            {{ broadcast.status === 'sent' ? 'Completed' : 'Stopped' }}
          </dt>
          <dd class="text-default">
            <TimeAgo :date="broadcast.completedAt" />
          </dd>
        </div>
        <div v-if="duration" class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Duration</dt>
          <dd class="text-default tabular-nums">
            {{ duration }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Created</dt>
          <dd class="text-default">
            <TimeAgo :date="broadcast.createdAt" />
          </dd>
        </div>
      </dl>
    </section>

    <section class="space-y-1.5">
      <h2 class="text-xs font-medium text-muted">Identifiers</h2>
      <div class="flex items-center justify-between gap-3 text-[13px]">
        <span class="text-muted">Broadcast</span>
        <CopyText :value="broadcast.id" class="max-w-40" />
      </div>
      <div v-if="broadcast.runId" class="flex items-center justify-between gap-3 text-[13px]">
        <span class="text-muted">Workflow run</span>
        <CopyText :value="broadcast.runId" class="max-w-40" />
      </div>
    </section>
  </div>
</template>
