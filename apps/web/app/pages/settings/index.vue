<script setup lang="ts">
definePageMeta({ permission: { settings: ['read'] } })

useSeoMeta({ title: 'General settings' })

const { can } = useOrganization()
const canReadDomains = computed(() => can({ domain: ['read'] }))

function senderPreview(name: string, email: string) {
  if (!email) return 'Not set'

  return name ? `${name} <${email}>` : email
}
</script>

<template>
  <SettingsDocument v-slot="{ state, group }" section="general">
    <SettingsCard
      title="Branding"
      description="The name contacts see on sign-up and preference pages and in system email. Members see the organization name."
      v-bind="group(['appName'])"
    >
      <UFormField label="Display name" name="appName" required>
        <UInput v-model="state.appName" placeholder="mlist" class="w-full" />
      </UFormField>
    </SettingsCard>

    <SettingsCard
      title="Company"
      description="Your legal identity, used in email footers through template variables."
      v-bind="group(['companyName', 'companyAddress'])"
    >
      <UFormField label="Company name" name="companyName">
        <UInput v-model="state.companyName" placeholder="Acme Inc." class="w-full" />
      </UFormField>
      <UFormField label="Postal address" name="companyAddress">
        <UTextarea
          v-model="state.companyAddress"
          :rows="3"
          autoresize
          placeholder="1 Main Street, Springfield, IL 62701, United States"
          class="w-full"
        />
        <template #help>
          Rendered by
          <code v-pre class="font-mono text-xs text-default">{{ company.address }}</code> in the
          default template footer.
        </template>
      </UFormField>
      <UAlert
        v-if="!state.companyAddress.trim()"
        color="warning"
        icon="i-lucide-scale"
        title="Add a postal address before sending marketing email"
        description="CAN-SPAM (US) and similar laws require a valid physical postal address in every commercial message."
      />
    </SettingsCard>

    <SettingsCard
      title="Default sender"
      description="Used for broadcasts and system email unless a message sets its own sender."
      v-bind="group(['defaultFromName', 'defaultFromEmail', 'defaultReplyTo'])"
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="From name" name="defaultFromName">
          <UInput v-model="state.defaultFromName" placeholder="Acme" class="w-full" />
        </UFormField>
        <UFormField label="From email" name="defaultFromEmail">
          <UInput
            v-model="state.defaultFromEmail"
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
          v-model="state.defaultReplyTo"
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
          senderPreview(state.defaultFromName, state.defaultFromEmail)
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
</template>
