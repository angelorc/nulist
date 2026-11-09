<script setup lang="ts">
import { parsePublicFailure } from '#shared/schemas/public'
import type { ConfirmationPreview, ConfirmationResult } from '#shared/schemas/public'

definePageMeta({ layout: 'public' })

useSeoMeta({ title: 'Confirm your subscription', robots: 'noindex, nofollow' })

useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const token = String(route.params.token ?? '')

type LinkProblemKind = 'expired' | 'invalid' | 'unavailable' | 'error'

/** What the recipient sees when the link can't be used. */
interface LinkProblem {
  kind: LinkProblemKind
  message: string | null
  /** Public list to sign up to again (expired links). */
  listId: string | null
}

/** Maps a failed request (fetch error of the preview or the confirmation) to the recipient's state. */
function problemOf(cause: unknown): LinkProblem {
  const { status, message, listId } = parsePublicFailure(cause)

  const kind: LinkProblemKind =
    status === 410
      ? 'expired'
      : status === 409
        ? 'unavailable'
        : status && status >= 400 && status < 500
          ? 'invalid'
          : 'error'

  return { kind, message, listId }
}

const {
  data: preview,
  error,
  status,
  refresh
} = await useFetch<ConfirmationPreview>(`/api/public/confirm/${token}`, { key: `confirm-${token}` })

/** Branding of the organization the link belongs to (neutral when the link is unusable). */
const brand = computed(() => preview.value?.brand ?? null)

const result = ref<ConfirmationResult | null>(null)
const failure = ref<LinkProblem | null>(null)
const confirming = ref(false)

const problem = computed(() => failure.value ?? (error.value ? problemOf(error.value) : null))

const state = computed(() => {
  if (result.value) return result.value.alreadyConfirmed ? 'already' : 'confirmed'

  if (problem.value) return problem.value.kind

  if (preview.value?.state === 'confirmed') return 'already'

  if (preview.value?.state === 'expired') return 'expired'

  return 'pending'
})

const listName = computed(() => result.value?.listName ?? preview.value?.list.name ?? 'the list')

const signUpAgainId = computed(
  () => problem.value?.listId ?? (preview.value?.canSignUpAgain ? preview.value.list.id : null)
)

async function confirm() {
  confirming.value = true
  failure.value = null

  try {
    result.value = await $fetch<ConfirmationResult>('/api/public/confirm', {
      method: 'POST',
      body: { token }
    })
  } catch (err) {
    failure.value = problemOf(err)
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <PublicCard v-if="state === 'pending' && preview" title="Confirm your subscription" :brand>
    <template #description>
      One click and <span class="font-medium text-highlighted">{{ preview.email }}</span> joins
      <span class="font-medium text-highlighted">{{ preview.list.name }}</span>.
    </template>

    <div class="flex flex-col gap-5">
      <blockquote
        v-if="preview.list.description"
        class="border-l-2 border-default pl-3 text-sm text-muted text-pretty"
      >
        {{ preview.list.description }}
      </blockquote>

      <UButton
        label="Confirm subscription"
        size="lg"
        block
        :loading="confirming"
        autofocus
        @click="confirm"
      />

      <p class="text-xs text-muted text-center text-pretty">
        Didn't sign up? Ignore the email and you won't be subscribed.
      </p>
    </div>
  </PublicCard>

  <PublicCard v-else-if="status === 'pending' && !preview" :brand loading>
    <div class="flex flex-col gap-5">
      <USkeleton class="h-4 w-3/4" />
      <USkeleton class="h-9 w-full" />
      <USkeleton class="h-3 w-56 max-w-full self-center" />
    </div>
  </PublicCard>

  <PublicCard v-else :brand>
    <PublicStatus
      v-if="state === 'confirmed'"
      icon="i-lucide-circle-check"
      tone="success"
      title="You're subscribed"
      autofocus
    >
      <template #description>
        Welcome to <span class="font-medium text-highlighted">{{ listName }}</span>. You can change
        what you receive at any time from the link at the bottom of our emails.
      </template>
    </PublicStatus>

    <PublicStatus
      v-else-if="state === 'already'"
      icon="i-lucide-circle-check"
      tone="success"
      title="You're already subscribed"
      autofocus
    >
      <template #description>
        Your subscription to <span class="font-medium text-highlighted">{{ listName }}</span> is
        confirmed. There is nothing else to do.
      </template>
    </PublicStatus>

    <PublicStatus
      v-else-if="state === 'expired'"
      icon="i-lucide-clock-alert"
      tone="warning"
      title="This link has expired"
      description="Confirmation links are only valid for a limited time. Sign up again to get a new one."
    >
      <UButton v-if="signUpAgainId" label="Sign up again" :to="`/subscribe/${signUpAgainId}`" />
    </PublicStatus>

    <PublicStatus
      v-else-if="state === 'unavailable'"
      icon="i-lucide-mail-x"
      title="This subscription can't be confirmed"
      :description="problem?.message ?? 'This address can\'t receive emails from us right now.'"
    />

    <PublicStatus
      v-else-if="state === 'invalid'"
      icon="i-lucide-link-2-off"
      tone="error"
      title="This link doesn't work"
      description="It may be incomplete. Copy the full link from the email and try again."
    />

    <PublicStatus
      v-else
      icon="i-lucide-triangle-alert"
      tone="error"
      title="Something went wrong"
      description="We couldn't reach the server. Check your connection and try again."
    >
      <UButton
        label="Try again"
        icon="i-lucide-rotate-cw"
        variant="outline"
        @click="failure ? confirm() : refresh()"
      />
    </PublicStatus>
  </PublicCard>
</template>
