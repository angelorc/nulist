<script setup lang="ts">
import { accessSettingsSchema } from '#shared/schemas/access'
import type { AccessSettings } from '#shared/schemas/access'

useSeoMeta({ title: 'Access' })

const { data: saved, refresh } = await useFetch<AccessSettings>('/api/admin/access', {
  default: () => ({ allowedDomains: [] })
})

const state = reactive<AccessSettings>({ allowedDomains: [...saved.value.allowedDomains] })

watch(saved, (value) => {
  state.allowedDomains = [...value.allowedDomains]
})

const dirty = computed(
  () => state.allowedDomains.join('\n') !== saved.value.allowedDomains.join('\n')
)

const { run: save, pending: saving } = useApiAction(
  (input: AccessSettings) =>
    $fetch<{ settings: AccessSettings; revokedSessions: number }>('/api/admin/access', {
      method: 'PUT',
      body: input
    }),
  { success: 'Access updated', error: 'Could not update access' }
)

async function onSubmit() {
  if (await save({ allowedDomains: state.allowedDomains })) await refresh()
}

function onDiscard() {
  state.allowedDomains = [...saved.value.allowedDomains]
}
</script>

<template>
  <SettingsCard
    title="Allowed domains"
    description="Only Google accounts with these email domains can sign in and be invited. Leave empty to allow any domain. Sign-up stays invitation only."
    :schema="accessSettingsSchema"
    :state="state"
    :dirty="dirty"
    :saving="saving"
    @submit="onSubmit"
    @discard="onDiscard"
  >
    <UFormField
      name="allowedDomains"
      label="Domains"
      help="Press Enter after each domain. Signed-in users of other domains are signed out on save."
    >
      <UInputTags
        v-model="state.allowedDomains"
        placeholder="mycompany.com"
        icon="i-lucide-at-sign"
        class="w-full"
      />
    </UFormField>
  </SettingsCard>
</template>
