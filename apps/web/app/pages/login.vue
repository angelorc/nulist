<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: 'auth' })

useSeoMeta({ title: 'Sign in' })

const { data: setup } = await useFetch('/api/setup')

if (setup.value?.needsSetup) await navigateTo('/setup')

const schema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password')
})

type Schema = z.output<typeof schema>

/** Same-origin path to return to after signing in ("//host" and "/\\host" are refused). */
const redirectSchema = z
  .string()
  .regex(/^\/(?![/\\])/)
  .catch('/')

const route = useRoute()
const organization = useOrganization()
const { execute, status, error } = useSignIn('email')

const fields = [
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
    autocomplete: 'current-password',
    type: 'password' as const,
    label: 'Password',
    placeholder: '••••••••••',
    required: true
  }
]

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const redirect = redirectSchema.parse(route.query.redirect)

  await execute(
    { email: event.data.email, password: event.data.password, rememberMe: true },
    {
      onSuccess: async () => {
        // A previous user's organization context must not leak into this session.
        organization.clear()
        await navigateTo(redirect)
      }
    }
  )
}
</script>

<template>
  <UPageCard class="w-full">
    <UAuthForm
      :schema="schema"
      :fields="fields"
      description="Sign in with your account. Invited? Open the link in your invitation email."
      :submit="{ label: 'Continue', block: true }"
      :loading="status === 'pending'"
      :ui="{ description: 'text-sm' }"
      @submit="onSubmit"
    >
      <template #title>
        <h1>Sign in</h1>
      </template>
      <template v-if="error" #validation>
        <UAlert
          color="error"
          icon="i-lucide-circle-alert"
          :title="error.message ?? 'Invalid email or password'"
        />
      </template>
    </UAuthForm>
  </UPageCard>
</template>
