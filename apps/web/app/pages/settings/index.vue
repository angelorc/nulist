<script setup lang="ts">
definePageMeta({ permission: { settings: ['read'] } })

useSeoMeta({ title: 'General settings' })
</script>

<template>
  <SettingsDocument v-slot="{ state, group }" section="general">
    <SettingsCard
      title="Branding"
      description="The name contacts see on sign-up and preference pages and in system email. Members see the organization name."
      v-bind="group(['appName'])"
    >
      <UFormField label="Display name" name="appName" required>
        <UInput v-model="state.appName" placeholder="nulist" class="w-full" />
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
  </SettingsDocument>
</template>
