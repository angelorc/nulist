<script setup lang="ts">
import type { ContactDetail } from '#shared/types/contacts'
import type { SuppressionReason } from '#shared/types/domain'

const props = defineProps<{ contact: ContactDetail }>()
const { number, dateTime } = useFormat()
const { can } = useOrganization()

/** The suppression list lives in Settings, readable with `suppression:read`. */
const canReadSuppressions = computed(() => can({ suppression: ['read'] }))

const SUPPRESSION_LABELS = {
  hard_bounce: 'Hard bounce',
  soft_bounce: 'Repeated soft bounces',
  complaint: 'Spam complaint',
  unsubscribe: 'Unsubscribed',
  manual: 'Blocked manually'
} as const satisfies Record<SuppressionReason, string>

const SOURCE_LABELS = new Map([
  ['import', 'CSV import'],
  ['dashboard', 'Dashboard'],
  ['api', 'API'],
  ['form', 'Subscribe form']
])

const sourceLabel = computed(() => {
  const source = props.contact.source

  if (!source) return null

  return SOURCE_LABELS.get(source) ?? source
})
</script>

<template>
  <div class="space-y-5">
    <UAlert
      v-if="contact.suppression"
      color="error"
      icon="i-lucide-ban"
      title="Suppressed"
      :ui="{ description: 'space-y-1 text-[13px]' }"
    >
      <template #description>
        <p>
          {{ SUPPRESSION_LABELS[contact.suppression.reason] }}
          <template v-if="contact.suppression.source">
            · {{ contact.suppression.source }}
          </template>
        </p>
        <p class="text-xs">
          Since {{ dateTime(contact.suppression.createdAt) }}.
          <template v-if="canReadSuppressions">
            Manage in
            <ULink
              :to="{ path: '/settings/suppressions', query: { q: contact.email } }"
              class="font-medium text-inherit underline underline-offset-2"
              >Settings → Suppressions</ULink
            >.
          </template>
          <template v-else>Managed in Settings → Suppressions.</template>
        </p>
      </template>
    </UAlert>

    <section>
      <h3 class="text-xs font-medium text-muted mb-2">Details</h3>
      <dl class="divide-y divide-default text-[13px]">
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Created</dt>
          <dd class="text-default">
            <TimeAgo :date="contact.createdAt" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Updated</dt>
          <dd class="text-default">
            <TimeAgo :date="contact.updatedAt" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Source</dt>
          <dd class="text-default truncate">
            <template v-if="sourceLabel">{{ sourceLabel }}</template>
            <span v-else class="text-dimmed">—</span>
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Consent</dt>
          <dd class="text-default">
            <TimeAgo :date="contact.consentAt" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Consent IP</dt>
          <dd class="min-w-0">
            <CopyText v-if="contact.consentIp" :value="contact.consentIp" />
            <span v-else class="text-dimmed">—</span>
          </dd>
        </div>
      </dl>
    </section>

    <section>
      <h3 class="text-xs font-medium text-muted mb-2">Engagement</h3>
      <dl class="divide-y divide-default text-[13px]">
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Last opened</dt>
          <dd class="text-default">
            <TimeAgo :date="contact.lastOpenedAt" fallback="Never" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Last clicked</dt>
          <dd class="text-default">
            <TimeAgo :date="contact.lastClickedAt" fallback="Never" />
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <dt class="text-muted">Soft bounces</dt>
          <dd
            class="tabular-nums"
            :class="contact.softBounceCount ? 'text-warning' : 'text-default'"
          >
            {{ number(contact.softBounceCount) }}
          </dd>
        </div>
      </dl>
    </section>

    <section>
      <h3 class="text-xs font-medium text-muted mb-2">Contact ID</h3>
      <CopyText :value="contact.id" class="max-w-full" />
    </section>
  </div>
</template>
