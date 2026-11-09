<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
import { roleLabel } from '#shared/auth/permissions'
import { INVITATION_HEADER } from '#shared/schemas/members'
import type { ActiveOrganizationChange, InvitationDetails } from '#shared/schemas/members'

/**
 * Invitation landing page (public: `/invitations/**` has no auth rule).
 * Signed out: sign in, or create an account with the invited email (sign-up
 * is invitation only), then the invitation is accepted. Signed in as the
 * invited email: accept or decline. Signed in as someone else: switch account.
 */
definePageMeta({ layout: 'auth' })

const route = useRoute()
const invitationId = String(route.params.id)
const detailsUrl: string = `/api/invitations/${invitationId}`

const { data: invitation, error } = await useFetch<InvitationDetails>(detailsUrl)

useSeoMeta({
  title: () => (invitation.value ? `Join ${invitation.value.organizationName}` : 'Invitation')
})

const { loggedIn, user, signOut } = useUserSession()
const organization = useOrganization()
const confirm = useConfirm()
const notify = useNotify()

type PageState = 'invalid' | 'closed' | 'signed-out' | 'recipient' | 'other-account'

const pageState = computed<PageState>(() => {
  const current = invitation.value

  if (error.value || !current) return 'invalid'

  if (current.status !== 'pending' || current.expired) return 'closed'

  if (!loggedIn.value) return 'signed-out'

  return user.value?.email.toLowerCase() === current.email.toLowerCase()
    ? 'recipient'
    : 'other-account'
})

const closedMessage = computed(() => {
  const current = invitation.value

  if (!current) return ''

  if (current.status === 'accepted') return 'This invitation was already accepted.'

  if (current.status === 'rejected') return 'This invitation was declined.'

  if (current.status === 'canceled') return 'This invitation was canceled.'

  return 'This invitation has expired. Ask for a new one.'
})

const { run: respond, pending: responding } = useApiAction(
  (action: 'accept' | 'reject') =>
    $fetch<ActiveOrganizationChange>(detailsUrl, { method: 'POST', body: { action } }),
  { error: 'Could not answer the invitation' }
)

async function accept() {
  const change = await respond('accept')

  if (!change) return
  notify.success(`Welcome to ${invitation.value?.organizationName ?? 'the organization'}`)
  await organization.refresh()
  await refreshNuxtData()
  await navigateTo('/')
}

async function decline() {
  const ok = await confirm({
    title: 'Decline this invitation?',
    description: 'The link stops working. You can be invited again later.',
    confirmLabel: 'Decline',
    danger: true
  })

  if (!ok || !(await respond('reject'))) return
  await organization.refresh()
  await navigateTo(organization.organization.value ? '/' : '/no-organization')
}

async function switchAccount() {
  await signOut({
    onSuccess: () => {
      organization.clear()
    }
  })
}

// Signed-out flows -----------------------------------------------------------

const tabs = computed<TabsItem[]>(() => [
  { label: 'Create account', value: 'sign-up', slot: 'sign-up' as const },
  { label: 'Sign in', value: 'sign-in', slot: 'sign-in' as const }
])

const activeTab = ref(invitation.value?.accountExists ? 'sign-in' : 'sign-up')

/** Who sent the invitation, as the start of the header sentence. */
const invitedBy = computed(() =>
  invitation.value?.inviterName ? `${invitation.value.inviterName} invited` : 'You were invited'
)

/** The invitation header (organization, inviter, role) shows once the link is valid. */
const showHeader = computed(() => pageState.value !== 'invalid' && invitation.value !== undefined)

const signInSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password')
})

const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.email('Enter a valid email'),
  password: z.string().min(10, 'Use at least 10 characters')
})

type SignInInput = z.output<typeof signInSchema>

type SignUpInput = z.output<typeof signUpSchema>

const signIn = useSignIn('email')
const signUp = useSignUp('email')

const signInFields = computed(() => [
  {
    name: 'email',
    autocomplete: 'email',
    type: 'email' as const,
    label: 'Email',
    defaultValue: invitation.value?.email,
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
])

const signUpFields = computed(() => [
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
    defaultValue: invitation.value?.email,
    readonly: true,
    help: 'The invitation is for this address.',
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
])

async function onSignIn(event: FormSubmitEvent<SignInInput>) {
  await signIn.execute(
    { email: event.data.email, password: event.data.password, rememberMe: true },
    { onSuccess: accept }
  )
}

async function onSignUp(event: FormSubmitEvent<SignUpInput>) {
  await signUp.execute(
    {
      name: event.data.name,
      email: invitation.value?.email ?? event.data.email,
      password: event.data.password
    },
    // Sign-up is bound to this invitation: the server checks the id from the link.
    { headers: { [INVITATION_HEADER]: invitationId }, onSuccess: accept }
  )
}
</script>

<template>
  <UPageCard
    class="w-full"
    :ui="showHeader ? { wrapper: 'items-center text-center', leading: 'mb-3' } : undefined"
  >
    <template v-if="showHeader && invitation" #leading>
      <AppOrganizationAvatar
        :name="invitation.organizationName"
        :logo="invitation.organizationLogo"
        size="lg"
      />
    </template>
    <template v-if="showHeader && invitation" #title>
      <h1>Join {{ invitation.organizationName }}</h1>
    </template>
    <template v-if="showHeader && invitation" #description>
      {{ invitedBy }} <span class="text-highlighted">{{ invitation.email }}</span> as
      {{ roleLabel(invitation.role) }}.
    </template>

    <EmptyState
      v-if="pageState === 'invalid'"
      variant="error"
      title="This invitation link is not valid"
      description="Check that you opened the full link from your invitation email, or ask for a new invitation."
      compact
    >
      <UButton label="Go to sign in" to="/login" variant="outline" />
    </EmptyState>

    <EmptyState
      v-else-if="pageState === 'closed'"
      icon="i-lucide-mail-x"
      :title="closedMessage"
      description="Invitations can be used once and expire after 7 days."
      compact
    >
      <UButton
        :label="loggedIn ? 'Go to dashboard' : 'Go to sign in'"
        :to="loggedIn ? '/' : '/login'"
        variant="outline"
      />
    </EmptyState>

    <div v-else-if="pageState === 'recipient'" class="flex flex-col gap-2">
      <UButton label="Accept invitation" block :loading="responding" @click="accept" />
      <UButton label="Decline" variant="ghost" block :disabled="responding" @click="decline" />
    </div>

    <div v-else-if="pageState === 'other-account'" class="flex flex-col gap-3">
      <UAlert
        color="warning"
        icon="i-lucide-circle-alert"
        title="This invitation is for another account"
        :description="`You're signed in as ${user?.email}. Sign in as ${invitation?.email} to accept it.`"
      />
      <UButton
        label="Sign out and switch account"
        icon="i-lucide-log-out"
        variant="outline"
        block
        @click="switchAccount"
      />
    </div>

    <UTabs
      v-else
      v-model="activeTab"
      :items="tabs"
      variant="link"
      size="sm"
      color="neutral"
      class="w-full"
      :ui="{ list: 'w-full', trigger: 'flex-1 justify-center' }"
    >
      <template #sign-up>
        <UAuthForm
          :schema="signUpSchema"
          :fields="signUpFields"
          description="Choose a password to create your account and join."
          :submit="{ label: 'Create account and join', block: true }"
          :loading="signUp.status.value === 'pending' || responding"
          :ui="{ description: 'text-sm' }"
          class="pt-4"
          @submit="onSignUp"
        >
          <template v-if="signUp.error.value" #validation>
            <UAlert
              color="error"
              icon="i-lucide-circle-alert"
              :title="signUp.error.value.message ?? 'Could not create the account'"
            />
          </template>
        </UAuthForm>
      </template>
      <template #sign-in>
        <UAuthForm
          :schema="signInSchema"
          :fields="signInFields"
          description="Already have an account? Sign in to accept."
          :submit="{ label: 'Sign in and join', block: true }"
          :loading="signIn.status.value === 'pending' || responding"
          :ui="{ description: 'text-sm' }"
          class="pt-4"
          @submit="onSignIn"
        >
          <template v-if="signIn.error.value" #validation>
            <UAlert
              color="error"
              icon="i-lucide-circle-alert"
              :title="signIn.error.value.message ?? 'Invalid email or password'"
            />
          </template>
        </UAuthForm>
      </template>
    </UTabs>
  </UPageCard>
</template>
