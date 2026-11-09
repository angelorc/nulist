<script setup lang="ts">
import type { SendingQuotaReport } from '#shared/schemas/domains'
import { LIMIT_FIELD_GROUPS } from '#shared/schemas/organization'
import type { LimitFieldGroup } from '#shared/schemas/organization'
import type { LimitSettings, LimitUsage } from '#shared/types/domain'

definePageMeta({ permission: { settings: ['read'] } })

useSeoMeta({ title: 'Limits' })

const { organization } = useOrganization()
const organizationKey = computed(() => organization.value?.id ?? 'none')

const {
  data: usage,
  status: usageStatus,
  error: usageError,
  refresh: refreshUsage
} = await useFetch<LimitUsage[]>('/api/limits', {
  key: () => `limits-usage:${organizationKey.value}`,
  default: () => []
})

const { data: quotaReport } = useFetch<SendingQuotaReport>('/api/settings/sending/quota', {
  key: () => `settings-quota:${organizationKey.value}`,
  lazy: true,
  server: false
})

const quota = computed(() => quotaReport.value?.quota ?? null)
const { number } = useFormat()

const limitKeys = (group: LimitFieldGroup): (keyof LimitSettings)[] =>
  group.fields.map((field) => field.key)
</script>

<template>
  <SettingsCard
    title="Usage"
    description="Current consumption against each limit. Limits apply to everyone in this organization and to its API keys."
  >
    <EmptyState
      v-if="usageError"
      variant="error"
      title="Usage could not be loaded"
      :description="apiErrorMessage(usageError)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        :loading="usageStatus === 'pending'"
        @click="refreshUsage()"
      />
    </EmptyState>
    <div
      v-else
      class="grid gap-x-8 gap-y-5 transition-opacity sm:grid-cols-2"
      :class="usageStatus === 'pending' && 'opacity-60'"
      :aria-busy="usageStatus === 'pending'"
    >
      <SettingsUsageMeter
        v-for="item in usage"
        :key="item.key"
        :label="item.label"
        :used="item.used"
        :limit="item.limit"
        :unit="item.unit"
      />
    </div>
    <template v-if="!usageError" #actions>
      <UButton
        label="Refresh"
        icon="i-lucide-refresh-cw"
        variant="ghost"
        :loading="usageStatus === 'pending'"
        @click="refreshUsage()"
      />
    </template>
  </SettingsCard>

  <SettingsDocument v-slot="{ state, group, canEdit }" section="limits">
    <SettingsCard
      v-for="limitGroup in LIMIT_FIELD_GROUPS"
      :key="limitGroup.id"
      :title="limitGroup.title"
      :description="limitGroup.description"
      v-bind="group(limitKeys(limitGroup))"
    >
      <SettingsLimitFieldGroup :limits="state" :group="limitGroup" :disabled="!canEdit" />
      <template v-if="limitGroup.id === 'sending'">
        <UAlert
          v-if="quota"
          icon="i-lucide-info"
          title="Amazon SES has its own quota"
          :description="`Your SES account allows ${number(quota.max24HourSend)} emails per 24 hours at ${number(quota.maxSendRate)} per second. These limits apply on top of it.`"
        />
        <p v-else class="text-[13px] text-muted">
          Your provider may enforce its own quota as well. With Amazon SES, it is shown in Settings
          → Sending.
        </p>
      </template>
    </SettingsCard>
  </SettingsDocument>
</template>
