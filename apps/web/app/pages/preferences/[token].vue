<script setup lang="ts">
import { NEUTRAL_PUBLIC_BRAND } from '#shared/schemas/public'
import type { PreferenceList, PublicPreferences } from '#shared/schemas/public'

definePageMeta({ layout: 'public' })

useSeoMeta({ title: 'Email preferences', robots: 'noindex, nofollow' })

useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const token = String(route.params.token ?? '')
const url: string = `/api/public/preferences/${token}`

const notify = useNotify()
const confirm = useConfirm()

const {
  data: prefs,
  error,
  status,
  refresh
} = await useFetch<PublicPreferences>(url, { key: `preferences-${token}` })

/** Branding of the organization the link belongs to (neutral when the link is unusable). */
const brand = computed(() => prefs.value?.brand ?? null)

const sender = computed(() => {
  const current = brand.value ?? NEUTRAL_PUBLIC_BRAND

  return current.companyName || current.appName
})

/** Ends a sentence with the sender without doubling the period of names like "Acme Inc.". */
const senderEnd = computed(() => (sender.value.endsWith('.') ? sender.value : `${sender.value}.`))

/** Local switch state; compared against the last server snapshot to know what changed. */
const lists = ref<Record<string, boolean>>({})
const topics = ref<Record<string, boolean>>({})

/** The form's state: what the switches show now. */
const selection = reactive({ lists, topics })

function reset(value: PublicPreferences | null | undefined) {
  lists.value = Object.fromEntries((value?.lists ?? []).map((l) => [l.id, l.subscribed]))
  topics.value = Object.fromEntries((value?.topics ?? []).map((t) => [t.id, t.subscribed]))
}

watch(prefs, reset, { immediate: true })

const changes = computed(() => {
  const current = prefs.value

  if (!current) return { lists: {}, topics: {} }

  return {
    lists: Object.fromEntries(
      current.lists
        .filter((l) => lists.value[l.id] !== l.subscribed)
        .map((l) => [l.id, lists.value[l.id] ?? l.subscribed])
    ),
    topics: Object.fromEntries(
      current.topics
        .filter((t) => topics.value[t.id] !== t.subscribed)
        .map((t) => [t.id, topics.value[t.id] ?? t.subscribed])
    )
  }
})

const dirty = computed(
  () => Object.keys(changes.value.lists).length + Object.keys(changes.value.topics).length > 0
)

const hasChoices = computed(
  () => !!prefs.value && (prefs.value.lists.length > 0 || prefs.value.topics.length > 0)
)

/** Second line under a list: what happens next for it (confirmation email, private list). */
function listHint(list: PreferenceList): string | null {
  if (list.pending) return 'Waiting for you to click the confirmation link we emailed.'

  if (!list.subscribed && lists.value[list.id] && list.optIn === 'double')
    return "We'll email you a link to confirm."

  if (list.subscribed && !list.canJoin && lists.value[list.id] === false)
    return "This list is private: once you save, you can't rejoin it from here."

  return null
}

const problem = computed(() => {
  if (!error.value) return null
  const code = error.value.statusCode ?? 0

  return code >= 400 && code < 500 ? 'invalid' : 'error'
})

const { run: save, pending: saving } = useApiAction(
  () => $fetch<PublicPreferences>(url, { method: 'PUT', body: changes.value }),
  { error: "Couldn't save your preferences" }
)

async function onSave() {
  const joiningDouble =
    prefs.value?.lists
      .filter((l) => !l.subscribed && changes.value.lists[l.id] && l.optIn === 'double')
      .map((l) => l.name) ?? []

  const updated = await save()

  if (!updated) return
  prefs.value = updated
  notify.success('Preferences saved', {
    description: joiningDouble.length
      ? `Check your inbox to confirm ${joiningDouble.join(', ')}.`
      : undefined
  })
}

// The page turns into the "You're unsubscribed" state, so the outcome needs no toast.
const { run: unsubscribe, pending: unsubscribing } = useApiAction(
  () => $fetch<PublicPreferences>(`${url}/unsubscribe-all`, { method: 'POST' }),
  { error: "Couldn't unsubscribe you" }
)

async function onUnsubscribeAll() {
  const ok = await confirm({
    title: 'Unsubscribe from all emails?',
    description: `You'll stop receiving newsletters and updates from ${senderEnd.value} Account and transactional emails may still arrive.`,
    confirmLabel: 'Unsubscribe from all',
    cancelLabel: 'Stay subscribed',
    danger: true
  })

  if (!ok) return
  const updated = await unsubscribe()

  if (updated) prefs.value = updated
}

const { run: resubscribe, pending: resubscribing } = useApiAction(
  () => $fetch<PublicPreferences>(`${url}/resubscribe`, { method: 'POST' }),
  { error: "Couldn't resubscribe you" }
)

async function onResubscribe() {
  const updated = await resubscribe()

  if (!updated) return
  prefs.value = updated
  notify.success("You're resubscribed", {
    description: 'Choose the lists you want to hear from.'
  })
}
</script>

<template>
  <!-- Loading (client-side refresh only: the first render is server-side) -->
  <PublicCard v-if="status === 'pending' && !prefs" title="Email preferences" :brand loading>
    <ul class="divide-y divide-default">
      <li v-for="i in 3" :key="i" class="flex items-start justify-between gap-4 py-3.5">
        <div class="flex-1 space-y-2">
          <USkeleton class="h-4 w-36" />
          <USkeleton class="h-3 w-56 max-w-full" />
        </div>
        <USkeleton class="h-5 w-9 rounded-full" />
      </li>
    </ul>
  </PublicCard>

  <!-- Invalid link / server error -->
  <PublicCard v-else-if="problem || !prefs" :brand>
    <PublicStatus
      v-if="problem === 'invalid'"
      icon="i-lucide-link-2-off"
      tone="error"
      title="This link doesn't work"
      description="It may be incomplete or no longer valid. Use the link at the bottom of one of our recent emails."
    />
    <PublicStatus
      v-else
      icon="i-lucide-triangle-alert"
      tone="error"
      title="Couldn't load your preferences"
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

  <!-- Globally unsubscribed -->
  <PublicCard v-else-if="prefs.status === 'unsubscribed'" :brand>
    <PublicStatus icon="i-lucide-mail-x" title="You're unsubscribed" autofocus>
      <template #description>
        <span class="font-medium text-highlighted">{{ prefs.email }}</span> won't receive
        newsletters or updates from {{ senderEnd }}
        <template v-if="prefs.canResubscribe"> Changed your mind? </template>
      </template>
      <UButton
        v-if="prefs.canResubscribe"
        label="Resubscribe"
        icon="i-lucide-rotate-ccw"
        :loading="resubscribing"
        @click="onResubscribe"
      />
    </PublicStatus>
  </PublicCard>

  <!-- Bounced, complained or blocked: nothing to manage -->
  <PublicCard v-else-if="prefs.status !== 'active'" :brand>
    <PublicStatus
      icon="i-lucide-mail-warning"
      tone="warning"
      title="We can't email this address"
      description="Messages to this address were returned or reported, so we stopped sending. Contact us if you think this is a mistake."
    />
  </PublicCard>

  <!-- Active: lists and topics -->
  <PublicCard v-else title="Email preferences" :brand>
    <template #description>
      Choose what <span class="font-medium text-highlighted">{{ prefs.email }}</span> receives from
      {{ senderEnd }}
    </template>

    <EmptyState
      v-if="!hasChoices"
      icon="i-lucide-sliders-horizontal"
      title="Nothing to choose from yet"
      description="There are no lists or topics to manage. You can still unsubscribe from all emails below."
      compact
    />

    <UForm
      v-else
      id="preferences-form"
      :state="selection"
      class="flex flex-col gap-6"
      @submit="onSave"
    >
      <section v-if="prefs.lists.length" aria-labelledby="lists-heading">
        <h2 id="lists-heading" class="text-xs font-medium text-muted">Lists</h2>
        <ul class="divide-y divide-default">
          <PublicPreferenceRow
            v-for="list in prefs.lists"
            :key="list.id"
            v-model="lists[list.id]"
            :name="list.name"
            :description="list.description"
            :hint="listHint(list)"
            :disabled="!list.canJoin && !list.subscribed"
          >
            <template #badges>
              <UBadge v-if="list.inScope" variant="outline" label="From this email" />
              <StatusBadge v-if="list.pending" status="unconfirmed" label="Pending" />
            </template>
          </PublicPreferenceRow>
        </ul>
      </section>

      <section v-if="prefs.topics.length" aria-labelledby="topics-heading">
        <h2 id="topics-heading" class="text-xs font-medium text-muted">Topics</h2>
        <ul class="divide-y divide-default">
          <PublicPreferenceRow
            v-for="topic in prefs.topics"
            :key="topic.id"
            v-model="topics[topic.id]"
            :name="topic.name"
            :description="topic.description"
          />
        </ul>
      </section>
    </UForm>

    <template v-if="hasChoices" #footer>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <UButton
          v-if="dirty"
          label="Discard changes"
          variant="ghost"
          class="justify-center"
          :disabled="saving"
          @click="reset(prefs)"
        />
        <p v-else class="hidden text-xs text-muted sm:block">Changes apply when you save.</p>
        <UButton
          type="submit"
          form="preferences-form"
          label="Save preferences"
          class="justify-center"
          :disabled="!dirty"
          :loading="saving"
        />
      </div>
    </template>

    <template #after>
      <UCard
        as="section"
        aria-labelledby="unsubscribe-heading"
        :ui="{ body: 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' }"
      >
        <div class="min-w-0">
          <h2 id="unsubscribe-heading" class="text-sm font-medium text-highlighted">
            Unsubscribe from all emails
          </h2>
          <p class="text-[13px] text-muted text-pretty">
            Stop every newsletter and update at once.
          </p>
        </div>
        <UButton
          label="Unsubscribe"
          color="error"
          variant="soft"
          class="shrink-0 justify-center"
          :loading="unsubscribing"
          @click="onUnsubscribeAll"
        />
      </UCard>
    </template>
  </PublicCard>
</template>
