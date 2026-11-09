<script setup lang="ts">
import type { FormSubmitEvent, TimelineItem } from '@nuxt/ui'
import { testEmailSchema } from '#shared/schemas/domains'
import type { SendingQuotaReport, TestEmailInput, TestEmailResult } from '#shared/schemas/domains'

definePageMeta({ permission: { settings: ['read'] } })

useSeoMeta({ title: 'Sending settings' })

const NO_PERMISSION = "You don't have permission to change sending settings"

const SES_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'af-south-1',
  'me-south-1',
  'il-central-1'
]

/** Read-only setup guide: numbered steps on a vertical timeline. */
const EVENT_STEPS: TimelineItem[] = [
  {
    value: 1,
    avatar: { text: '1' },
    title: 'Create a configuration set',
    description:
      'In the SES console, create a configuration set and turn on open and click tracking.'
  },
  {
    value: 2,
    avatar: { text: '2' },
    title: 'Add an event destination',
    description:
      'Add an Amazon SNS event destination for Send, Delivery, Bounce, Complaint, Reject, Delivery delay, Open and Click.'
  },
  {
    value: 3,
    avatar: { text: '3' },
    title: 'Subscribe the SNS topic',
    description:
      'Subscribe the topic to the mlist SES endpoint over HTTPS. mlist confirms the subscription automatically.'
  },
  {
    value: 4,
    avatar: { text: '4' },
    title: 'Save the configuration set',
    description: 'Enter the configuration set name under Provider and save.'
  }
]

const providerItems = [
  {
    value: 'ses',
    label: 'Amazon SES API',
    description:
      'Sends through the SESv2 API. Unlocks quota, domain management and configuration sets.'
  },
  {
    value: 'smtp',
    label: 'SMTP',
    description: 'Any SMTP server, including the Amazon SES SMTP interface.'
  }
]

const { user } = useUserSession()
const { organization, can } = useOrganization()
const canUpdate = computed(() => can({ settings: ['update'] }))
const canReadWebhooks = computed(() => can({ webhook: ['read'] }))
const canReadDomains = computed(() => can({ domain: ['read'] }))

function senderPreview(name: string, email: string) {
  if (!email) return 'Not set'

  return name ? `${name} <${email}>` : email
}

// Quota is optional context: load it without blocking the page.
const {
  data: quotaReport,
  status: quotaStatus,
  refresh: refreshQuota
} = useFetch<SendingQuotaReport>('/api/settings/sending/quota', {
  key: () => `settings-quota:${organization.value?.id ?? 'none'}`,
  lazy: true,
  server: false
})

const quota = computed(() => quotaReport.value?.quota ?? null)
const { number, percent } = useFormat()

function isSesSmtpHost(host: string) {
  return /^email-smtp(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/i.test(host.trim())
}

// Test email ---------------------------------------------------------------
const testState = reactive<TestEmailInput>({ to: user.value?.email ?? '' })
const lastTest = ref<{ to: string; messageId: string; at: Date } | null>(null)

const { run: sendTest, pending: sendingTest } = useApiAction(
  (body: TestEmailInput) =>
    $fetch<TestEmailResult>('/api/settings/sending/test-email', { method: 'POST', body }),
  { success: (result) => `Test email sent to ${result.to}`, error: 'Test email failed' }
)

async function onSendTest(event: FormSubmitEvent<TestEmailInput>) {
  const result = await sendTest(event.data)

  if (result) lastTest.value = { to: result.to, messageId: result.messageId, at: new Date() }
}
</script>

<template>
  <SettingsDocument
    v-slot="{ state, group, isDirty, canEdit }"
    section="sending"
    @saved="refreshQuota()"
  >
    <!-- Provider --------------------------------------------------------- -->
    <SettingsCard
      title="Provider"
      description="How mlist hands email to the internet. Credentials are encrypted at rest."
      v-bind="group(['provider', 'ses', 'smtp'])"
    >
      <UFormField name="provider" label="Send with">
        <URadioGroup
          v-model="state.provider"
          :items="providerItems"
          variant="card"
          orientation="horizontal"
          :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2', item: 'items-start' }"
        />
      </UFormField>

      <template v-if="state.provider === 'ses'">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Region" name="ses.region" required>
            <USelectMenu
              v-model="state.ses.region"
              :items="SES_REGIONS"
              :search-input="{ placeholder: 'Search regions…' }"
              create-item
              class="w-full"
              :ui="{ base: 'font-mono' }"
              @create="(item: string) => (state.ses.region = item)"
            />
          </UFormField>
          <UFormField
            label="Configuration set"
            name="ses.configurationSet"
            help="Publishes delivery, bounce and engagement events."
          >
            <UInput
              v-model="state.ses.configurationSet"
              placeholder="mlist-events"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
        </div>
        <UFormField
          label="Access key ID"
          name="ses.accessKeyId"
          help="Leave empty to use the server's AWS credential chain (instance role, environment)."
        >
          <UInput
            v-model="state.ses.accessKeyId"
            placeholder="AKIA…"
            autocomplete="off"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="Secret access key" name="ses.secretAccessKey">
          <SettingsSecretInput
            v-model="state.ses.secretAccessKey"
            placeholder="Paste the secret access key"
            :disabled="!canEdit"
          />
        </UFormField>
      </template>

      <template v-else>
        <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <UFormField label="Host" name="smtp.host" required>
            <UInput
              v-model="state.smtp.host"
              placeholder="email-smtp.us-east-1.amazonaws.com"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
          <UFormField label="Port" name="smtp.port" required>
            <UInputNumber
              v-model="state.smtp.port"
              :min="1"
              :max="65535"
              :format-options="{ useGrouping: false }"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField name="smtp.secure">
          <USwitch
            v-model="state.smtp.secure"
            label="Implicit TLS"
            description="Use for port 465. Leave off for port 587 or 2587, which upgrade with STARTTLS."
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Username" name="smtp.user">
            <UInput
              v-model="state.smtp.user"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
          <UFormField label="Password" name="smtp.pass">
            <SettingsSecretInput v-model="state.smtp.pass" :disabled="!canEdit" />
          </UFormField>
        </div>
        <UAlert
          v-if="isSesSmtpHost(state.smtp.host) && !state.smtp.sesHeaders"
          color="info"
          icon="i-lucide-info"
          title="Amazon SES SMTP detected"
          description="Turn on SES headers so messages carry the configuration set and tags used to track delivery events."
          :actions="
            canEdit
              ? [
                  {
                    label: 'Turn on',
                    variant: 'outline',
                    size: 'sm',
                    onClick: () => {
                      state.smtp.sesHeaders = true
                    }
                  }
                ]
              : []
          "
        />
        <UFormField name="smtp.sesHeaders">
          <USwitch
            v-model="state.smtp.sesHeaders"
            label="Amazon SES headers"
            description="Adds X-SES-CONFIGURATION-SET and X-SES-MESSAGE-TAGS for event tracking through the SES SMTP interface."
          />
        </UFormField>
        <UFormField
          v-if="state.smtp.sesHeaders"
          label="Configuration set"
          name="smtp.configurationSet"
        >
          <UInput
            v-model="state.smtp.configurationSet"
            placeholder="mlist-events"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
      </template>

      <template #actions>
        <SettingsConnectionTest
          endpoint="/api/settings/sending/verify"
          :draft="state"
          :disabled="!canUpdate"
          :disabled-reason="NO_PERMISSION"
        />
      </template>
    </SettingsCard>

    <!-- Default sender (stored in the general section) ------------------- -->
    <SettingsDocument
      v-slot="{ state: general, group: generalGroup }"
      section="general"
      :notice="false"
    >
      <SettingsCard
        title="Default sender"
        description="Used for broadcasts and system email unless a message sets its own sender."
        v-bind="generalGroup(['defaultFromName', 'defaultFromEmail', 'defaultReplyTo'])"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="From name" name="defaultFromName">
            <UInput v-model="general.defaultFromName" placeholder="Acme" class="w-full" />
          </UFormField>
          <UFormField label="From email" name="defaultFromEmail">
            <UInput
              v-model="general.defaultFromEmail"
              type="email"
              placeholder="hello@acme.com"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField
          label="Reply-to"
          name="defaultReplyTo"
          help="Leave empty to receive replies at the from address."
        >
          <UInput
            v-model="general.defaultReplyTo"
            type="email"
            placeholder="support@acme.com"
            class="w-full"
          />
        </UFormField>
        <div
          class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-elevated/50 px-3 py-2 text-[13px] ring ring-default"
        >
          <span class="text-muted">Recipients see</span>
          <span class="min-w-0 truncate font-mono text-xs text-highlighted">{{
            senderPreview(general.defaultFromName, general.defaultFromEmail)
          }}</span>
        </div>
        <p class="text-[13px] text-muted">
          The from domain must be verified with your provider.
          <ULink v-if="canReadDomains" to="/settings/domains" class="font-medium text-primary"
            >Check domains</ULink
          >
        </p>
      </SettingsCard>
    </SettingsDocument>

    <!-- SES quota ---------------------------------------------------------- -->
    <SettingsCard
      v-if="quota || quotaReport?.error"
      title="SES quota"
      description="Account limits reported by Amazon SES for this region, refreshed on every visit."
    >
      <template v-if="quota">
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-3 text-[13px]">
            <span class="font-medium text-default">Sent in the last 24 hours</span>
            <span class="tabular-nums text-muted">
              <span class="text-highlighted">{{ number(quota.sentLast24Hours) }}</span> /
              {{ number(quota.max24HourSend) }}
            </span>
          </div>
          <UProgress
            :model-value="Math.min(quota.sentLast24Hours, quota.max24HourSend)"
            :max="Math.max(quota.max24HourSend, 1)"
            :color="
              quota.max24HourSend && quota.sentLast24Hours / quota.max24HourSend >= 0.8
                ? 'warning'
                : 'primary'
            "
            size="sm"
            :aria-label="`${number(quota.sentLast24Hours)} of ${number(quota.max24HourSend)} emails sent in the last 24 hours`"
          />
          <p class="text-xs text-muted tabular-nums">
            {{ percent(quota.max24HourSend ? quota.sentLast24Hours / quota.max24HourSend : 0) }}
            used
          </p>
        </div>
        <dl class="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <dt class="text-muted">Maximum send rate</dt>
            <dd class="mt-0.5 text-highlighted font-medium tabular-nums">
              {{ number(quota.maxSendRate) }} / second
            </dd>
          </div>
          <div>
            <dt class="text-muted">Status</dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <StatusBadge
                :status="quota.sendingEnabled ? 'active' : 'paused'"
                :label="quota.sendingEnabled ? 'Sending enabled' : 'Sending paused'"
              />
              <StatusBadge
                v-if="quota.productionAccess === false"
                status="pending"
                label="Sandbox"
              />
            </dd>
          </div>
        </dl>
        <UAlert
          v-if="quota.productionAccess === false"
          color="warning"
          icon="i-lucide-flask-conical"
          title="Your SES account is in the sandbox"
          description="You can only send to verified addresses, up to 200 emails a day. Request production access in the AWS console before sending broadcasts."
        />
      </template>
      <UAlert
        v-else
        color="error"
        icon="i-lucide-circle-alert"
        title="Could not read the SES quota"
        :description="quotaReport?.error ?? undefined"
      />
      <template #actions>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          variant="ghost"
          :loading="quotaStatus === 'pending'"
          @click="refreshQuota()"
        />
      </template>
    </SettingsCard>

    <!-- Throughput --------------------------------------------------------- -->
    <SettingsCard
      title="Throughput"
      description="How fast broadcasts go out. Stay at or below your provider's rate limit."
      v-bind="group(['ratePerSecond'])"
    >
      <UFormField label="Messages per second" name="ratePerSecond" required>
        <UInputNumber v-model="state.ratePerSecond" :min="1" :max="1000" class="w-40" />
        <template #help>
          <span v-if="quota && state.ratePerSecond > quota.maxSendRate" class="text-warning">
            Higher than your SES maximum of {{ number(quota.maxSendRate) }} per second; SES will
            throttle sending.
          </span>
          <span v-else-if="quota"
            >Your SES account allows up to {{ number(quota.maxSendRate) }} per second.</span
          >
          <span v-else
            >New SES accounts allow 1 per second in the sandbox and 14 per second in
            production.</span
          >
        </template>
      </UFormField>
    </SettingsCard>

    <!-- Deliverability ----------------------------------------------------- -->
    <SettingsCard
      title="Deliverability"
      description="Protect your sender reputation by suppressing addresses that keep failing."
      v-bind="group(['softBounceThreshold', 'optInExpiryDays'])"
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Soft bounce threshold"
          name="softBounceThreshold"
          help="Soft bounces before an address is suppressed. Hard bounces and complaints suppress immediately."
        >
          <UInputNumber v-model="state.softBounceThreshold" :min="1" :max="50" class="w-full" />
        </UFormField>
        <UFormField
          label="Opt-in expiry (days)"
          name="optInExpiryDays"
          help="Unconfirmed double opt-in subscriptions expire after this many days."
        >
          <UInputNumber v-model="state.optInExpiryDays" :min="1" :max="60" class="w-full" />
        </UFormField>
      </div>
    </SettingsCard>

    <!-- Test email --------------------------------------------------------- -->
    <SettingsCard
      title="Send a test email"
      description="Sends a short branded message with the saved provider and default sender."
    >
      <UForm
        id="test-email-form"
        :schema="testEmailSchema"
        :state="testState"
        :disabled="!canUpdate"
        class="space-y-3"
        @submit="onSendTest"
      >
        <UFormField label="Recipient" name="to">
          <UInput
            v-model="testState.to"
            type="email"
            placeholder="you@company.com"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="isDirty(['provider', 'ses', 'smtp'])"
          icon="i-lucide-info"
          description="The test uses the saved provider. Save your provider changes first, or use Test connection."
        />
        <div role="status" class="empty:hidden">
          <UAlert
            v-if="lastTest"
            color="success"
            icon="i-lucide-circle-check"
            :title="`Accepted for delivery to ${lastTest.to}`"
          >
            <template #description>
              <span class="inline-flex flex-wrap items-center gap-x-1.5">
                Message ID
                <CopyText :value="lastTest.messageId" />
              </span>
            </template>
          </UAlert>
        </div>
      </UForm>
      <template #actions>
        <Can v-slot="{ allowed }" :permission="{ settings: ['update'] }" :explain="NO_PERMISSION">
          <UButton
            type="submit"
            form="test-email-form"
            label="Send test email"
            icon="i-lucide-send"
            variant="outline"
            :loading="sendingTest"
            :disabled="!allowed"
          />
        </Can>
      </template>
    </SettingsCard>

    <!-- Event tracking ----------------------------------------------------- -->
    <SettingsCard
      title="Event tracking"
      description="Delivery, bounce, complaint, open and click events come back from SES through a configuration set."
    >
      <UTimeline :items="EVENT_STEPS" size="xs" :ui="{ description: 'text-[13px]' }" />
      <p class="text-[13px] text-muted">
        Bounces and complaints suppress addresses automatically; every event is also forwarded to
        your own webhooks.
      </p>
      <template v-if="canReadWebhooks" #actions>
        <UButton
          label="Endpoint and webhooks"
          to="/webhooks"
          trailing-icon="i-lucide-arrow-right"
          variant="ghost"
        />
      </template>
    </SettingsCard>
  </SettingsDocument>
</template>
