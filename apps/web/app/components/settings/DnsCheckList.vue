<script setup lang="ts">
import type { DnsCheckStatus, DomainCheckResult } from '#shared/schemas/domains'

/** Live DNS check results with pass / warn / fail, guidance and the record values. */
const props = defineProps<{ result: DomainCheckResult }>()

const STATUS: Record<
  DnsCheckStatus,
  { icon: string; class: string; badge: string; label: string }
> = {
  pass: { icon: 'i-lucide-circle-check', class: 'text-success', badge: 'success', label: 'Pass' },
  warn: {
    icon: 'i-lucide-triangle-alert',
    class: 'text-warning',
    badge: 'pending',
    label: 'Warning'
  },
  fail: { icon: 'i-lucide-circle-x', class: 'text-error', badge: 'failed', label: 'Fail' }
}

const summary = computed(() => {
  const { pass, warn, fail } = props.result.summary

  return [
    pass ? `${pass} passed` : null,
    warn ? `${warn} ${warn === 1 ? 'warning' : 'warnings'}` : null,
    fail ? `${fail} failed` : null
  ]
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span class="tabular-nums">{{ summary }}</span>
      <span>Checked <TimeAgo :date="result.checkedAt" /></span>
    </div>
    <ul
      class="divide-y divide-default rounded-md ring ring-default"
      :aria-label="`DNS checks for ${result.domain}`"
    >
      <li v-for="check in result.checks" :key="check.id" class="flex gap-3 p-3">
        <UIcon
          :name="STATUS[check.status].icon"
          class="mt-0.5 size-4 shrink-0"
          :class="STATUS[check.status].class"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-[13px] font-medium text-highlighted">{{ check.label }}</span>
            <StatusBadge :status="STATUS[check.status].badge" :label="STATUS[check.status].label" />
            <span class="font-mono text-xs text-muted truncate min-w-0"
              >{{ check.record.type }} {{ check.record.name }}</span
            >
          </div>
          <p class="text-[13px] text-muted text-pretty">
            {{ check.help }}
          </p>
          <dl class="space-y-1 text-xs">
            <div v-if="check.found.length" class="flex gap-2 min-w-0">
              <dt class="w-16 shrink-0 text-muted">Found</dt>
              <dd class="min-w-0 space-y-0.5">
                <p
                  v-for="value in check.found"
                  :key="value"
                  class="font-mono text-default break-all"
                >
                  {{ value }}
                </p>
              </dd>
            </div>
            <div v-if="check.status !== 'pass'" class="flex gap-2 min-w-0">
              <dt class="w-16 shrink-0 text-muted">Expected</dt>
              <dd class="min-w-0">
                <CopyText
                  v-if="!check.record.placeholder"
                  :value="
                    check.record.priority !== undefined
                      ? `${check.record.priority} ${check.record.value}`
                      : check.record.value
                  "
                  :truncate="false"
                  class="break-all"
                />
                <span v-else class="font-mono text-muted break-all">{{ check.record.value }}</span>
              </dd>
            </div>
          </dl>
        </div>
      </li>
    </ul>
  </div>
</template>
