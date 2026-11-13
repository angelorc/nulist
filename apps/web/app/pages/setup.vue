<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })

useSeoMeta({ title: 'Set up nulist' })

const { data: setup } = await useFetch('/api/setup')

if (setup.value && !setup.value.needsSetup) await navigateTo('/login')

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.email('Enter a valid email'),
  password: z.string().min(10, 'Use at least 10 characters')
})

type Schema = z.output<typeof schema>

const organization = useOrganization()
const { execute, status, error } = useSignUp('email')

const google = useGoogleSignIn({ callbackURL: '/settings/organization' })

const passwordEnabled = import.meta.dev

const providers = computed(() => (setup.value?.googleEnabled ? [google.provider.value] : []))

const fields = passwordEnabled
  ? [
      {
        name: 'name',
        autocomplete: 'name',
        type: 'text' as const,
        label: 'Name',
        placeholder: 'Ada Lovelace',
        required: true
      },
      {
        name: 'email',
        autocomplete: 'email',
        type: 'email' as const,
        label: 'Email',
        placeholder: 'you@company.com',
        required: true
      },
      {
        name: 'password',
        autocomplete: 'new-password',
        type: 'password' as const,
        label: 'Password',
        placeholder: 'At least 10 characters',
        required: true
      }
    ]
  : []

async function onSubmit(event: FormSubmitEvent<Schema>) {
  await execute(event.data, {
    onSuccess: async () => {
      organization.clear()
      await navigateTo('/settings/organization')
    }
  })
}
</script>

<template>
  <UPageCard class="w-full">
    <UAuthForm
      :schema="schema"
      :fields="fields"
      :providers="providers"
      description="This first account becomes the instance admin and owner of your first organization."
      :submit="{ label: 'Create account', block: true }"
      :loading="status === 'pending'"
      :ui="{ description: 'text-sm' }"
      @submit="onSubmit"
    >
      <template #title>
        <h1>Create the admin account</h1>
      </template>
      <template v-if="error" #validation>
        <UAlert
          color="error"
          icon="i-lucide-circle-alert"
          :title="error.message ?? 'Could not create the account'"
        />
      </template>
      <template v-if="google.failure.value" #footer>
        <UAlert color="error" icon="i-lucide-circle-alert" :title="google.failure.value" />
      </template>
      <template v-else-if="!setup?.googleEnabled && !passwordEnabled" #footer>
        <UAlert
          color="warning"
          icon="i-lucide-triangle-alert"
          title="Google sign-in is not configured"
          description="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server."
        />
      </template>
    </UAuthForm>
  </UPageCard>
</template>
