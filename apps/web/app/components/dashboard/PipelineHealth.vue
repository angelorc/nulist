<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ApiLogStats, EmailLogStats, InboundEventStats } from '#shared/types/logs'
import type { DateRangeValue } from '~/utils/logLinks'

type Tone = 'success' | 'warning' | 'error' | 'neutral'

interface PipelineRow {
  key: string
  icon: string
  title: string
  to: RouteLocationRaw
  tone: Tone
  state: string
  lastAt: string | null
  facts: { label: string; value: string }[]
}

const props = defineProps<{ range: DateRangeValue }>()

const { organization } = useOrganization()
const { number, percent } = useFormat()

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-(--ui-color-neutral-400)'
}

const query = computed(() =>
  LogLinks.query({ period: props.range.period, from: props.range.from, to: props.range.to })
)

const key = (name: string) => () =>
  `dashboard-pipeline:${name}:${organization.value?.id ?? 'none'}:${Object.values(query.value).join(':')}`

const options = { query, lazy: true, server: false, default: () => null } as const

const events = useFetch<InboundEventStats | null>('/api/logs/inbound/stats', {
  ...options,
  key: key('events')
})

const api = useFetch<ApiLogStats | null>('/api/logs/api/stats', { ...options, key: key('api') })

const emails = useFetch<EmailLogStats | null>('/api/logs/emails/stats', {
  ...options,
  key: key('emails')
})

const loading = computed(() =>
  [events, api, emails].some(
    (r) => r.status.value !== 'success' && r.status.value !== 'error' && !r.data.value
  )
)

const rows = computed<PipelineRow[]>(() => {
  const e = events.data.value
  const a = api.data.value
  const m = emails.data.value
  const apiErrors = a ? a.facets['4xx'] + a.facets['5xx'] : 0
  const serverErrors = a?.facets['5xx'] ?? 0

  return [
    {
      key: 'ses',
      icon: 'i-lucide-radio-tower',
      title: 'Amazon SES events',
      to: LogLinks.events({ ...props.range }),
      tone: !e?.lastAt ? 'neutral' : e.facets.failed ? 'warning' : 'success',
      state: !e?.lastAt
        ? 'No events received yet'
        : e.facets.failed
          ? `${number(e.facets.failed)} failed to process`
          : 'Receiving events',
      lastAt: e?.lastAt ?? null,
      facts: [
        { label: 'Events', value: number(e?.total) },
        { label: 'Bounces', value: number(e?.types.find((t) => t.type === 'Bounce')?.count) }
      ]
    },
    {
      key: 'api',
      icon: 'i-lucide-terminal',
      title: 'REST API',
      to: LogLinks.api({ ...props.range }),
      tone: !a?.total ? 'neutral' : serverErrors ? 'error' : apiErrors ? 'warning' : 'success',
      state: !a?.total
        ? 'No requests in this period'
        : serverErrors
          ? `${number(serverErrors)} server errors`
          : `${percent(apiErrors / a.total)} error rate`,
      lastAt: a?.lastAt ?? null,
      facts: [
        { label: 'Requests', value: number(a?.total) },
        { label: 'p95', value: a?.p95Ms == null ? '—' : `${number(a.p95Ms)} ms` }
      ]
    },
    {
      key: 'queue',
      icon: 'i-lucide-send',
      title: 'Sending',
      to: LogLinks.emails({ ...props.range }),
      tone: !m?.total ? 'neutral' : m.facets.issues ? 'warning' : 'success',
      state: !m?.total
        ? 'Nothing sent in this period'
        : `${number(m.facets.in_flight)} in progress · ${number(m.facets.issues)} with issues`,
      lastAt: m?.lastAt ?? null,
      facts: [
        { label: 'Emails', value: number(m?.total) },
        { label: 'Delivered', value: m?.total ? percent(m.facets.delivered / m.total) : '—' }
      ]
    }
  ]
})
</script>

<template>
  <DashboardSection title="Pipeline" description="Email, event and API traffic health" flush>
    <div v-if="loading" class="space-y-2 p-4" aria-busy="true">
      <USkeleton v-for="n in 3" :key="n" class="h-16 w-full" />
    </div>
    <ul v-else class="divide-y divide-default border-t border-default">
      <li v-for="row in rows" :key="row.key">
        <ULink
          :to="row.to"
          class="flex items-start gap-3 px-4 py-3 hover:bg-elevated/50 focus-visible:bg-elevated/50 focus-visible:outline-none transition-colors"
        >
          <UIcon :name="row.icon" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-[13px] font-medium text-highlighted">{{ row.title }}</span>
              <span class="shrink-0 text-xs text-muted">
                <TimeAgo :date="row.lastAt" fallback="Never" />
              </span>
            </span>
            <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="TONE_DOT[row.tone]"
                aria-hidden="true"
              />
              <span class="truncate">{{ row.state }}</span>
            </span>
            <span class="mt-2 flex gap-4 text-xs">
              <span v-for="fact in row.facts" :key="fact.label" class="text-muted">
                {{ fact.label }}
                <span class="ms-1 font-medium text-highlighted tabular-nums">{{ fact.value }}</span>
              </span>
            </span>
          </span>
        </ULink>
      </li>
    </ul>
  </DashboardSection>
</template>
