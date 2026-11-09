<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { domainCheckSchema } from '#shared/schemas/domains'
import type { DomainCheckInput, DomainCheckResult } from '#shared/schemas/domains'

/** Provider-agnostic DNS check for any domain (works without SES). */
const props = defineProps<{ initialDomain?: string }>()

const state = reactive<{ domain: string; mailFromDomain: string }>({
  domain: props.initialDomain ?? '',
  mailFromDomain: ''
})

watch(
  () => props.initialDomain,
  (domain) => {
    if (domain && !state.domain) state.domain = domain
  }
)

const showAdvanced = ref(false)
const result = ref<DomainCheckResult | null>(null)

const { run, pending } = useApiAction(
  (body: DomainCheckInput) =>
    $fetch<DomainCheckResult>('/api/domains/check', { method: 'POST', body }),
  { error: 'DNS check failed' }
)

async function onSubmit(event: FormSubmitEvent<DomainCheckInput>) {
  const checked = await run(event.data)

  if (checked) result.value = checked
}
</script>

<template>
  <div class="space-y-4">
    <UForm :schema="domainCheckSchema" :state="state" class="space-y-3" @submit="onSubmit">
      <div class="flex flex-wrap items-start gap-2">
        <UFormField name="domain" class="min-w-48 flex-1">
          <UInput
            v-model="state.domain"
            placeholder="acme.com"
            icon="i-lucide-globe"
            autocomplete="off"
            spellcheck="false"
            aria-label="Domain to check"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UButton
          type="submit"
          label="Check DNS"
          icon="i-lucide-stethoscope"
          variant="outline"
          :loading="pending"
        />
      </div>
      <UCollapsible v-model:open="showAdvanced" class="space-y-3">
        <UButton
          :label="showAdvanced ? 'Hide MAIL FROM domain' : 'Add a MAIL FROM domain'"
          trailing-icon="i-lucide-chevron-down"
          variant="link"
          size="sm"
          class="group px-0"
          :ui="{
            trailingIcon:
              'transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none'
          }"
        />
        <template #content>
          <UFormField
            label="MAIL FROM domain"
            name="mailFromDomain"
            help="The return-path subdomain your provider bounces to, such as bounce.acme.com."
          >
            <UInput
              v-model="state.mailFromDomain"
              placeholder="bounce.acme.com"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
        </template>
      </UCollapsible>
    </UForm>

    <div v-if="pending && !result" class="space-y-2" aria-busy="true">
      <span class="sr-only">Checking DNS records</span>
      <USkeleton v-for="i in 3" :key="i" class="h-14 w-full" />
    </div>
    <SettingsDnsCheckList v-else-if="result" :result="result" :class="pending && 'opacity-60'" />
    <p v-else class="text-[13px] text-muted">
      Enter a domain to see whether receivers can authenticate mail from it.
    </p>
  </div>
</template>
