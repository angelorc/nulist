<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import {
  NEUTRAL_PUBLIC_BRAND,
  parsePublicFailure,
  signupFormSchema,
  signupIssueSchema,
  signupOutcomeSchema
} from '#shared/schemas/public'
import type {
  PublicListInfo,
  PublicSignupResult,
  SignupFormInput,
  SignupIssue,
  SignupOutcome
} from '#shared/schemas/public'

definePageMeta({ layout: 'public' })

const route = useRoute()
const listId = String(route.params.listId ?? '')
const listUrl: string = `/api/public/lists/${listId}`

const {
  data: list,
  error,
  status,
  refresh
} = await useFetch<PublicListInfo>(listUrl, { key: `public-list-${listId}` })

/** Branding of the organization that owns the list (neutral while unknown). */
const brand = computed(() => list.value?.brand ?? null)

const sender = computed(() => {
  const current = brand.value ?? NEUTRAL_PUBLIC_BRAND

  return current.companyName || current.appName
})

useSeoMeta({
  title: () => (list.value ? `Subscribe to ${list.value.name}` : 'Subscribe'),
  description: () => list.value?.description ?? undefined
})

/** Embedded HTML forms (no JavaScript) land here with ?status=… after a 303 redirect. */
const outcome = ref<SignupOutcome | null>(
  signupOutcomeSchema.safeParse(route.query.status).data ?? null
)

const issue = ref<SignupIssue | null>(signupIssueSchema.safeParse(route.query.status).data ?? null)

const submittedEmail = ref('')

const state = reactive<SignupFormInput>({ email: '', firstName: '' })

/** Honeypot: hidden from people and assistive tech, filled by naive bots. */
const website = ref('')

/** The server rejected the address: shown on the email field until it changes. */
const emailError = computed(() =>
  issue.value === 'invalid' ? 'Check the email address and try again.' : undefined
)

/** Failures that are not about a field (rate limit, server error): shown above the form. */
const formIssue = computed(() =>
  issue.value === 'rate-limited'
    ? 'Too many attempts from this network. Wait a minute and try again.'
    : issue.value === 'error'
      ? "We couldn't process your signup. Please try again in a moment."
      : null
)

watch(
  () => state.email,
  () => {
    if (issue.value === 'invalid') issue.value = null
  }
)

async function onSubmit(event: FormSubmitEvent<SignupFormInput>) {
  issue.value = null

  try {
    const result = await $fetch<PublicSignupResult>('/api/public/subscribe', {
      method: 'POST',
      body: {
        listId,
        email: event.data.email,
        firstName: event.data.firstName || undefined,
        website: website.value || undefined
      }
    })

    submittedEmail.value = event.data.email ?? ''
    outcome.value = result.optIn === 'double' ? 'check-email' : 'subscribed'
  } catch (err) {
    const failure = parsePublicFailure(err)
    issue.value =
      failure.status === 429 ? 'rate-limited' : failure.status === 422 ? 'invalid' : 'error'
  }
}

function startOver() {
  outcome.value = null
  issue.value = null
  state.email = ''
  state.firstName = ''

  if (route.query.status) navigateTo({ query: {} }, { replace: true })
}
</script>

<template>
  <PublicCard v-if="status === 'pending' && !list" :brand loading>
    <div class="flex flex-col gap-4">
      <div v-for="i in 2" :key="i" class="flex flex-col gap-1.5">
        <USkeleton class="h-4 w-20" />
        <USkeleton class="h-9 w-full" />
      </div>
      <USkeleton class="h-9 w-full" />
      <USkeleton class="h-3 w-full" />
    </div>
  </PublicCard>

  <PublicCard v-else-if="error || !list" :brand>
    <PublicStatus
      v-if="error && error.statusCode && error.statusCode < 500"
      icon="i-lucide-list-x"
      title="This signup form isn't available"
      description="The list may have been closed to new subscribers. Check the link or contact the sender."
    />
    <PublicStatus
      v-else
      icon="i-lucide-triangle-alert"
      tone="error"
      title="Couldn't load this form"
      description="Check your connection and try again."
    >
      <UButton
        label="Try again"
        icon="i-lucide-rotate-cw"
        variant="outline"
        @click="() => refresh()"
      />
    </PublicStatus>
  </PublicCard>

  <PublicCard v-else-if="outcome === 'check-email'" :brand>
    <PublicStatus
      icon="i-lucide-mail-check"
      tone="success"
      title="Check your inbox to confirm"
      autofocus
    >
      <template #description>
        We sent a confirmation link to
        <span v-if="submittedEmail" class="font-medium text-highlighted">{{ submittedEmail }}</span>
        <template v-else> your email address </template>. Click it to finish subscribing to
        <span class="font-medium text-highlighted">{{ list.name }}</span>.
      </template>
      <UButton label="Use a different email" variant="outline" @click="startOver" />
      <template #footer>Nothing after a few minutes? Check your spam folder.</template>
    </PublicStatus>
  </PublicCard>

  <PublicCard v-else-if="outcome === 'subscribed'" :brand>
    <PublicStatus icon="i-lucide-circle-check" tone="success" title="You're subscribed" autofocus>
      <template #description>
        Thanks for joining <span class="font-medium text-highlighted">{{ list.name }}</span>. Look
        out for our next email.
      </template>
    </PublicStatus>
  </PublicCard>

  <PublicCard
    v-else
    :title="`Subscribe to ${list.name}`"
    :description="list.description ?? undefined"
    :brand
  >
    <UForm :schema="signupFormSchema" :state class="flex flex-col gap-4" @submit="onSubmit">
      <UAlert
        v-if="formIssue"
        color="error"
        icon="i-lucide-circle-alert"
        :title="formIssue"
        close
        @update:open="issue = null"
      />

      <UFormField label="Email" name="email" size="lg" required :error="emailError">
        <UInput
          v-model="state.email"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="you@example.com"
          class="w-full"
          autofocus
        />
      </UFormField>

      <UFormField label="First name" name="firstName" size="lg" hint="Optional">
        <UInput v-model="state.firstName" autocomplete="given-name" class="w-full" />
      </UFormField>

      <!-- Honeypot: off-screen and hidden from assistive tech; only bots fill it. -->
      <div class="absolute -left-[9999px] size-px overflow-hidden" aria-hidden="true">
        <UInput
          id="signup-website"
          v-model="website"
          name="website"
          tabindex="-1"
          autocomplete="off"
          aria-label="Website"
        />
      </div>

      <UButton type="submit" label="Subscribe" size="lg" block loading-auto />

      <p class="text-xs text-muted text-pretty">
        By subscribing you agree to receive emails from {{ sender }} about {{ list.name }}.
        <template v-if="list.optIn === 'double'">
          We'll ask you to confirm your address first.
        </template>
        You can unsubscribe at any time with the link in every email.
      </p>
    </UForm>
  </PublicCard>
</template>
