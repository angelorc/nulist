<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { addDomainSchema } from '#shared/schemas/domains'
import type { AddDomainInput, DomainIdentity } from '#shared/schemas/domains'

const emit = defineEmits<{ close: [identity: DomainIdentity | null] }>()

const state = reactive<AddDomainInput>({ domain: '' })

const { run, pending } = useApiAction(
  (body: AddDomainInput) => $fetch<DomainIdentity>('/api/domains', { method: 'POST', body }),
  {
    success: (identity) => `${identity.name} added. Publish the DNS records to verify it.`,
    error: 'Could not add the domain'
  }
)

async function onSubmit(event: FormSubmitEvent<AddDomainInput>) {
  const identity = await run(event.data)

  if (identity) emit('close', identity)
}
</script>

<template>
  <UModal
    title="Add domain"
    description="Amazon SES creates three DKIM keys for the domain. You publish them as CNAME records."
    @update:open="(open: boolean) => !open && emit('close', null)"
  >
    <template #body>
      <UForm
        id="domain-add-form"
        :schema="addDomainSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Domain"
          name="domain"
          required
          help="Use the domain in your from address. A subdomain such as news.acme.com keeps marketing reputation separate."
        >
          <UInput
            v-model="state.domain"
            placeholder="acme.com"
            autocomplete="off"
            spellcheck="false"
            autofocus
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', null)" />
      <UButton type="submit" form="domain-add-form" label="Add domain" :loading="pending" />
    </template>
  </UModal>
</template>
