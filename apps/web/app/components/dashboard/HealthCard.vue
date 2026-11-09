<script setup lang="ts">
import type { DeliverabilityHealth, HealthStatus } from '#shared/types/analytics'

const props = defineProps<{ health: DeliverabilityHealth }>()

const { number, precisePercent, shortPercent } = useFormat()

/** Maps health to the shared status palette (StatusBadge). */
const BADGE: Record<HealthStatus, { status: string; label: string }> = {
  healthy: { status: 'success', label: 'Healthy' },
  warning: { status: 'delayed', label: 'At risk' },
  critical: { status: 'error', label: 'Critical' }
}

/** Meter fill and the guidance alert, by status. Healthy guidance is a neutral notice. */
const TONE: Record<
  HealthStatus,
  { meter: 'success' | 'warning' | 'error'; alert: 'neutral' | 'warning' | 'error'; icon: string }
> = {
  healthy: { meter: 'success', alert: 'neutral', icon: 'i-lucide-shield-check' },
  warning: { meter: 'warning', alert: 'warning', icon: 'i-lucide-shield-alert' },
  critical: { meter: 'error', alert: 'error', icon: 'i-lucide-shield-alert' }
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  healthy: 'healthy',
  warning: 'at risk',
  critical: 'critical'
}

const LOW_VOLUME = 200

const metrics = computed(() => {
  const h = props.health
  const t = h.thresholds

  return [
    {
      key: 'bounce',
      label: 'Bounce rate',
      value: h.bounceRate,
      count: h.bounced,
      noun: h.bounced === 1 ? 'hard bounce' : 'hard bounces',
      status: h.bounceStatus,
      warn: t.bounceWarn,
      critical: t.bounceCritical,
      max: t.bounceCritical * 1.5,
      legend: `Warning at ${shortPercent(t.bounceWarn)} · SES review at ${shortPercent(t.bounceCritical)}`
    },
    {
      key: 'complaint',
      label: 'Complaint rate',
      value: h.complaintRate,
      count: h.complained,
      noun: h.complained === 1 ? 'complaint' : 'complaints',
      status: h.complaintStatus,
      warn: t.complaintWarn,
      critical: t.complaintCritical,
      max: t.complaintCritical * 1.5,
      legend: `Warning at ${shortPercent(t.complaintWarn)} · SES review at ${shortPercent(t.complaintCritical)} · Gmail limit 0.3%`
    }
  ].map((m) =>
    Object.assign(m, {
      warnAt: `${(m.warn / m.max) * 100}%`,
      criticalAt: `${(m.critical / m.max) * 100}%`
    })
  )
})

const guidance = computed(() => {
  const h = props.health

  if (h.sent === 0)
    return 'Nothing was sent in the last 7 days. Rates appear here once emails go out.'
  const notes: string[] = []

  if (h.bounceStatus === 'critical')
    notes.push(
      'Bounces are above the 5% level where Amazon SES reviews accounts. Pause sends to old or imported segments and remove invalid addresses.'
    )
  else if (h.bounceStatus === 'warning')
    notes.push(
      'Bounces are climbing. Clean addresses that have not engaged recently and avoid purchased or scraped lists.'
    )

  if (h.complaintStatus === 'critical')
    notes.push(
      'Complaints exceed 0.1%, the SES review threshold. Send only to people who opted in and make unsubscribing obvious.'
    )
  else if (h.complaintStatus === 'warning')
    notes.push(
      'Complaints are getting close to provider limits. Check that recipients expect your emails and the unsubscribe link is easy to find.'
    )

  if (!notes.length)
    notes.push(
      'Bounce and complaint rates are well below the levels where Amazon SES and mailbox providers take action.'
    )

  if (h.sent < LOW_VOLUME)
    notes.push(`Based on ${number(h.sent)} emails, so a single bounce moves the rate a lot.`)

  return notes.join(' ')
})
</script>

<template>
  <DashboardSection
    title="Deliverability"
    :description="`Rolling ${health.windowDays} days · ${number(health.sent)} sent`"
  >
    <template #actions>
      <StatusBadge :status="BADGE[health.status].status" :label="BADGE[health.status].label" />
    </template>

    <div class="space-y-5">
      <div v-for="m in metrics" :key="m.key" class="space-y-2">
        <div class="flex items-baseline justify-between gap-3">
          <p class="text-[13px] text-muted min-w-0 truncate">
            {{ m.label }}
            <span class="tabular-nums">· {{ number(m.count) }} {{ m.noun }}</span>
          </p>
          <p
            class="text-sm font-semibold tabular-nums"
            :class="
              m.status === 'healthy'
                ? 'text-highlighted'
                : m.status === 'warning'
                  ? 'text-warning'
                  : 'text-error'
            "
          >
            {{ precisePercent(m.value) }}
          </p>
        </div>
        <div
          class="relative"
          role="meter"
          :aria-label="m.label"
          :aria-valuenow="m.value"
          aria-valuemin="0"
          :aria-valuemax="m.max"
          :aria-valuetext="`${precisePercent(m.value)}, ${STATUS_TEXT[m.status]}`"
        >
          <UProgress
            :model-value="Math.min(m.value, m.max)"
            :max="m.max"
            :color="TONE[m.status].meter"
            size="sm"
            aria-hidden="true"
          />
          <span
            class="absolute -top-1 -bottom-1 w-px bg-warning/70"
            :style="{ left: m.warnAt }"
            aria-hidden="true"
          />
          <span
            class="absolute -top-1 -bottom-1 w-px bg-error/70"
            :style="{ left: m.criticalAt }"
            aria-hidden="true"
          />
        </div>
        <p class="text-xs text-muted">
          {{ m.legend }}
        </p>
      </div>

      <UAlert
        :color="TONE[health.status].alert"
        :icon="TONE[health.status].icon"
        :description="guidance"
        :ui="{ description: 'text-[13px]' }"
      />
    </div>
  </DashboardSection>
</template>
