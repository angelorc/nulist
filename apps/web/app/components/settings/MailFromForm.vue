<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { MX_FAILURE_BEHAVIORS, mailFromFormSchema } from '#shared/schemas/domains'
import type { DomainIdentity, MailFromFormInput, MailFromInput } from '#shared/schemas/domains'

/**
 * Custom MAIL FROM (return-path) subdomain for an SES identity: aligns SPF with
 * the from domain. `disabled` (no `domain:update`) makes it read-only.
 */
const props = defineProps<{ identity: DomainIdentity; disabled?: boolean }>()
const emit = defineEmits<{ saved: [identity: DomainIdentity] }>()

const suffix = computed(() => `.${props.identity.name}`)

function initial(): MailFromFormInput {
  const current = props.identity.mailFrom.domain ?? ''

  return {
    subdomain: current.endsWith(suffix.value) ? current.slice(0, -suffix.value.length) : '',
    behaviorOnMxFailure: props.identity.mailFrom.behaviorOnMxFailure
  }
}

const state = reactive<MailFromFormInput>(initial())

watch(
  () => props.identity,
  () => Object.assign(state, initial())
)

const dirty = computed(() => JSON.stringify(state) !== JSON.stringify(initial()))

const { run, pending } = useApiAction(
  (body: MailFromInput) => {
    const url: string = `/api/domains/${encodeURIComponent(props.identity.name)}/mail-from`

    return $fetch<DomainIdentity>(url, { method: 'PUT', body })
  },
  {
    success: (identity) =>
      identity.mailFrom.domain
        ? `MAIL FROM set to ${identity.mailFrom.domain}`
        : 'Custom MAIL FROM removed',
    error: 'Could not update MAIL FROM'
  }
)

async function save(input: MailFromFormInput) {
  if (props.disabled) return

  const identity = await run({
    mailFromDomain: input.subdomain ? `${input.subdomain}${suffix.value}` : '',
    behaviorOnMxFailure: input.behaviorOnMxFailure
  })

  if (identity) emit('saved', identity)
}

function onSubmit(event: FormSubmitEvent<MailFromFormInput>) {
  return save(event.data)
}

function clear() {
  return save({ subdomain: '', behaviorOnMxFailure: 'USE_DEFAULT_VALUE' })
}
</script>

<template>
  <UForm
    :schema="mailFromFormSchema"
    :state="state"
    :disabled="disabled"
    class="space-y-4"
    @submit="onSubmit"
  >
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="MAIL FROM domain" name="subdomain" class="flex-1 min-w-56">
        <UInput
          v-model="state.subdomain"
          placeholder="mail"
          autocomplete="off"
          spellcheck="false"
          class="w-full"
          :ui="{ base: 'font-mono', trailing: 'pointer-events-none' }"
        >
          <template #trailing>
            <span class="font-mono text-xs text-muted">{{ suffix }}</span>
          </template>
        </UInput>
      </UFormField>
      <SettingsIdentityStatusBadge
        v-if="identity.mailFrom.status"
        :status="identity.mailFrom.status"
        class="mb-2"
      />
    </div>
    <UFormField label="If the MX record is missing" name="behaviorOnMxFailure">
      <URadioGroup
        v-model="state.behaviorOnMxFailure"
        :items="[...MX_FAILURE_BEHAVIORS]"
        variant="table"
      />
    </UFormField>
    <div v-if="!disabled" class="flex flex-wrap justify-end gap-2">
      <UButton
        v-if="identity.mailFrom.domain"
        label="Use SES default"
        variant="ghost"
        :disabled="pending"
        @click="clear"
      />
      <UButton
        type="submit"
        label="Save MAIL FROM"
        variant="outline"
        :loading="pending"
        :disabled="!dirty"
      />
    </div>
  </UForm>
</template>
