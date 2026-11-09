<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent, TabsItem } from '@nuxt/ui'
import { ContactsListPickerModal } from '#components'
import { contactProfileSchema } from '#shared/schemas/contacts'
import type { ContactProfileInput } from '#shared/schemas/contacts'
import type { ContactActivityItem, ContactDetail } from '#shared/types/contacts'
import type { ContactStatus } from '#shared/types/domain'

definePageMeta({ permission: { contact: ['read'] } })

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const detailUrl: string = `/api/contacts/${id}`

const {
  data: contact,
  refresh,
  error
} = await useFetch<ContactDetail>(detailUrl, { key: `contact-${id}` })

// Another organization's contact is "not found"; a missing permission stays a 403.
if (error.value?.statusCode === 403) {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: "You don't have permission to view this contact.",
    fatal: true
  })
}

if (error.value || !contact.value) {
  throw createError({
    // A malformed id (422 from the route's uuid check) is as unknown as a missing one.
    statusCode: !error.value || [404, 422].includes(error.value.statusCode ?? 0) ? 404 : 500,
    statusMessage: 'Contact not found',
    fatal: true
  })
}

const { can } = useOrganization()
const canUpdate = computed(() => can({ contact: ['update'] }))
const canDelete = computed(() => can({ contact: ['delete'] }))

const fullName = computed(() =>
  [contact.value?.firstName, contact.value?.lastName].filter(Boolean).join(' ')
)

const title = computed(() => fullName.value || contact.value?.email || 'Contact')

const initials = computed(() => {
  const source = fullName.value || contact.value?.email || '?'

  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
})

useSeoMeta({ title })

const { copy } = useClipboard({ legacy: true })
const notify = useNotify()
const confirm = useConfirm()
const overlay = useOverlay()
const listPicker = overlay.create(ContactsListPickerModal)

// Tabs (kept in the URL so links can point at a section) ------------------------
const activeSubscriptions = computed(
  () => contact.value?.subscriptions.filter((s) => s.status !== 'unsubscribed').length ?? 0
)

const tabs = computed<TabsItem[]>(() => [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-user' },
  {
    label: 'Lists',
    value: 'lists',
    icon: 'i-lucide-list',
    badge: activeSubscriptions.value
      ? { label: String(activeSubscriptions.value), class: 'tabular-nums' }
      : undefined
  },
  { label: 'Activity', value: 'activity', icon: 'i-lucide-activity' }
])

const tab = computed<string>({
  get: () =>
    ['lists', 'activity'].includes(String(route.query.tab)) ? String(route.query.tab) : 'overview',
  set: (value) =>
    router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } })
})

// Activity (loaded when the tab opens) -----------------------------------------
const activityUrl: string = `/api/contacts/${id}/activity`

const {
  data: activity,
  status: activityStatus,
  error: activityError,
  execute: loadActivity
} = useFetch<ContactActivityItem[]>(activityUrl, {
  key: `contact-activity-${id}`,
  immediate: false,
  default: () => []
})

watch(
  tab,
  (value) => {
    if (value === 'activity') loadActivity()
  },
  { immediate: true }
)

const EMAIL_ACTIVITY = new Set([
  'message',
  'send',
  'delivery',
  'open',
  'click',
  'bounce',
  'complaint',
  'reject',
  'delivery_delay',
  'rendering_failure',
  'failed'
])

const hasEmailActivity = computed(() =>
  activity.value.some((item) => EMAIL_ACTIVITY.has(item.type))
)

async function refreshAll() {
  await refresh()

  if (tab.value === 'activity') await loadActivity()
}

// Profile form -------------------------------------------------------------------
const profile = reactive<ContactProfileInput>({ email: '', firstName: '', lastName: '' })

function resetProfile() {
  profile.email = contact.value?.email ?? ''
  profile.firstName = contact.value?.firstName ?? ''
  profile.lastName = contact.value?.lastName ?? ''
}

watch(contact, resetProfile, { immediate: true })

const profileDirty = computed(
  () =>
    profile.email.trim().toLowerCase() !== contact.value?.email ||
    (profile.firstName ?? '').trim() !== (contact.value?.firstName ?? '') ||
    (profile.lastName ?? '').trim() !== (contact.value?.lastName ?? '')
)

const { run: saveProfile, pending: savingProfile } = useApiAction(
  (body: { email: string; firstName: string | null; lastName: string | null }) =>
    $fetch<unknown>(detailUrl, { method: 'PATCH', body }),
  { success: 'Profile saved' }
)

async function onProfileSubmit(event: FormSubmitEvent<ContactProfileInput>) {
  const saved = await saveProfile({
    email: event.data.email,
    firstName: event.data.firstName || null,
    lastName: event.data.lastName || null
  })

  if (saved) await refresh()
}

// Actions ------------------------------------------------------------------------
const listsUrl: string = `/api/contacts/${id}/lists`

const { run: subscribe } = useApiAction(
  (listId: string, skipOptIn: boolean) =>
    $fetch<{ result: string }>(listsUrl, { method: 'POST', body: { listId, skipOptIn } }),
  {
    success: ({ result }) =>
      result === 'unconfirmed'
        ? 'Confirmation email sent'
        : result === 'already_subscribed'
          ? 'Already on this list'
          : 'Added to list'
  }
)

async function addToList() {
  const exclude =
    contact.value?.subscriptions.filter((s) => s.status !== 'unsubscribed').map((s) => s.listId) ??
    []

  const pick = await listPicker.open({
    title: 'Add to list',
    description: contact.value?.email,
    confirmLabel: 'Add to list',
    mode: 'add',
    exclude
  }).result

  if (pick && (await subscribe(pick.listId, pick.skipOptIn))) await refreshAll()
}

const { run: unsubscribeAll } = useApiAction(
  () => $fetch<unknown>(listsUrl, { method: 'DELETE', body: { listId: null } }),
  { success: 'Unsubscribed from all emails' }
)

async function onUnsubscribeAll() {
  const ok = await confirm({
    title: `Unsubscribe ${contact.value?.email}?`,
    description:
      'They leave every list and are added to the suppression list. Transactional emails still go through.',
    confirmLabel: 'Unsubscribe'
  })

  if (ok && (await unsubscribeAll()) !== undefined) await refreshAll()
}

const { run: setStatus } = useApiAction(
  (status: ContactStatus) => $fetch<unknown>(detailUrl, { method: 'PATCH', body: { status } }),
  { success: 'Status updated' }
)

async function onBlock() {
  const ok = await confirm({
    title: `Block ${contact.value?.email}?`,
    description:
      'No email of any kind, transactional included, is sent to this address until it is reactivated.',
    confirmLabel: 'Block contact',
    danger: true
  })

  if (ok && (await setStatus('blocklisted'))) await refreshAll()
}

async function onReactivate() {
  const ok = await confirm({
    title: `Reactivate ${contact.value?.email}?`,
    description:
      contact.value?.status === 'bounced' || contact.value?.status === 'complained'
        ? 'The address bounced or complained before. It stays on the suppression list until you remove it in Settings → Suppressions.'
        : 'The contact can receive broadcasts again from the lists they are subscribed to.',
    confirmLabel: 'Reactivate'
  })

  if (ok && (await setStatus('active'))) await refreshAll()
}

const { run: remove } = useApiAction(() => $fetch<unknown>(detailUrl, { method: 'DELETE' }), {
  success: 'Contact deleted'
})

async function onDelete() {
  const ok = await confirm({
    title: `Delete ${contact.value?.email}?`,
    description:
      "Their profile, list memberships and attributes are removed. Sent email logs are kept. This can't be undone.",
    confirmLabel: 'Delete contact',
    danger: true
  })

  if (ok && (await remove()) !== undefined) await navigateTo('/contacts')
}

async function copyEmail() {
  await copy(contact.value?.email ?? '')
  notify.success('Email copied')
}

const menuItems = computed(() => {
  const status = contact.value?.status

  const unsubscribeItem = {
    label: 'Unsubscribe from all',
    icon: 'i-lucide-mail-x',
    onSelect: onUnsubscribeAll
  }

  const blockItem = { label: 'Block contact', icon: 'i-lucide-ban', onSelect: onBlock }

  const reactivateItem = {
    label: 'Reactivate',
    icon: 'i-lucide-rotate-ccw',
    onSelect: onReactivate
  }

  const statusItems =
    status === 'active'
      ? [unsubscribeItem, blockItem]
      : status === 'unsubscribed'
        ? [reactivateItem, blockItem]
        : [reactivateItem]

  const groups: DropdownMenuItem[][] = [
    [
      {
        label: 'Copy email',
        icon: 'i-lucide-copy',
        onSelect: copyEmail
      }
    ]
  ]

  if (canUpdate.value) groups.push(statusItems)

  if (canDelete.value)
    groups.push([
      { label: 'Delete contact', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }
    ])

  return groups
})

const stats = computed(() => [
  { label: 'Emails', value: contact.value?.stats.messages ?? 0 },
  { label: 'Delivered', value: contact.value?.stats.delivered ?? 0 },
  {
    label: 'Opened',
    value: contact.value?.stats.opened ?? 0,
    hint: 'Estimated: Apple Mail Privacy Protection inflates opens'
  },
  { label: 'Clicked', value: contact.value?.stats.clicked ?? 0 }
])
</script>

<template>
  <UDashboardPanel id="contact-detail">
    <template #header>
      <UDashboardNavbar :title="title" :ui="{ title: 'truncate' }">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/contacts"
            aria-label="Back to contacts"
          />
        </template>
        <template #trailing>
          <StatusBadge :status="contact?.status" />
        </template>
        <template #right>
          <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More actions" />
          </UDropdownMenu>
          <Can v-slot="{ allowed }" :permission="{ contact: ['update'] }" explain>
            <UTooltip
              text="Reactivate the contact to add it to lists"
              :disabled="!allowed || contact?.status === 'active'"
            >
              <UButton
                icon="i-lucide-list-plus"
                aria-label="Add to list"
                :disabled="!allowed || contact?.status !== 'active'"
                @click="addToList"
              >
                <span class="hidden sm:inline">Add to list</span>
              </UButton>
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <UTabs v-model="tab" :items="tabs" :content="false" size="sm" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div v-if="contact" class="flex flex-col lg:flex-row gap-8 lg:gap-10">
        <div class="flex-1 min-w-0 flex flex-col gap-6">
          <!-- Identity -->
          <div class="flex items-center gap-4">
            <UAvatar
              :text="initials"
              size="xl"
              :ui="{ root: 'ring ring-default', fallback: 'text-base text-highlighted' }"
            />
            <div class="min-w-0">
              <p class="text-base font-semibold text-highlighted truncate">
                {{ fullName || contact.email }}
              </p>
              <div class="flex items-center gap-1 min-w-0 text-sm text-muted">
                <span class="truncate">{{ contact.email }}</span>
                <CopyButton :value="contact.email" label="email" class="shrink-0 -my-1" />
              </div>
            </div>
          </div>

          <!-- Overview -->
          <div v-if="tab === 'overview'" class="flex flex-col gap-8">
            <div
              class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-(--ui-border) rounded-lg ring ring-default overflow-hidden"
            >
              <KpiCard
                v-for="stat in stats"
                :key="stat.label"
                :label="stat.label"
                :value="stat.value"
                :hint="stat.hint"
                class="bg-default"
              />
            </div>

            <section class="space-y-3" aria-labelledby="contact-profile">
              <div>
                <h2 id="contact-profile" class="text-base font-semibold text-highlighted">
                  Profile
                </h2>
                <p class="text-sm text-muted">
                  Available in templates as
                  <code v-pre class="font-mono text-xs">{{ contact.first_name }}</code> and
                  <code v-pre class="font-mono text-xs">{{ contact.last_name }}</code>.
                </p>
              </div>
              <UForm
                :schema="contactProfileSchema"
                :state="profile"
                :disabled="!canUpdate"
                class="space-y-4"
                novalidate
                @submit="onProfileSubmit"
              >
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <UFormField label="First name" name="firstName">
                    <UInput v-model="profile.firstName" autocomplete="off" class="w-full" />
                  </UFormField>
                  <UFormField label="Last name" name="lastName">
                    <UInput v-model="profile.lastName" autocomplete="off" class="w-full" />
                  </UFormField>
                  <UFormField
                    label="Email"
                    name="email"
                    required
                    class="sm:col-span-2"
                    help="Changing the address keeps lists, attributes and history."
                  >
                    <UInput
                      v-model="profile.email"
                      type="email"
                      autocomplete="off"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <div v-if="canUpdate" class="flex justify-end gap-2">
                  <UButton
                    v-if="profileDirty"
                    label="Discard"
                    variant="ghost"
                    size="sm"
                    @click="resetProfile"
                  />
                  <UButton
                    type="submit"
                    label="Save profile"
                    variant="outline"
                    size="sm"
                    :disabled="!profileDirty"
                    :loading="savingProfile"
                  />
                </div>
              </UForm>
            </section>

            <USeparator />

            <section class="space-y-3" aria-labelledby="contact-attributes">
              <div>
                <h2 id="contact-attributes" class="text-base font-semibold text-highlighted">
                  Attributes
                </h2>
                <p class="text-sm text-muted">
                  Custom data for personalization and segments. Numbers and true/false are detected
                  automatically.
                </p>
              </div>
              <ContactsAttributesEditor
                :contact-id="contact.id"
                :attributes="contact.attributes"
                :readonly="!canUpdate"
                @saved="refresh"
              />
            </section>

            <template v-if="contact.topics.length">
              <USeparator />
              <section class="space-y-3" aria-labelledby="contact-topics">
                <div>
                  <h2 id="contact-topics" class="text-base font-semibold text-highlighted">
                    Topics
                  </h2>
                  <p class="text-sm text-muted">
                    Preferences chosen in the preference center. Defaults apply until the contact
                    makes a choice.
                  </p>
                </div>
                <ul class="rounded-lg ring ring-default divide-y divide-default">
                  <li
                    v-for="topic in contact.topics"
                    :key="topic.topicId"
                    class="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div class="min-w-0">
                      <p class="text-sm text-highlighted truncate">
                        {{ topic.name }}
                      </p>
                      <p v-if="topic.description" class="text-xs text-muted truncate">
                        {{ topic.description }}
                      </p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span v-if="!topic.explicit" class="text-xs text-muted">Default</span>
                      <StatusBadge :status="topic.subscribed ? 'subscribed' : 'unsubscribed'" />
                    </div>
                  </li>
                </ul>
              </section>
            </template>
          </div>

          <!-- Lists -->
          <ContactsSubscriptions
            v-else-if="tab === 'lists'"
            :contact-id="contact.id"
            :email="contact.email"
            :contact-status="contact.status"
            :subscriptions="contact.subscriptions"
            :can-edit="canUpdate"
            @changed="refreshAll"
            @add="addToList"
          />

          <!-- Activity -->
          <section v-else aria-label="Activity" class="flex flex-col gap-6">
            <EmptyState
              v-if="activityError"
              variant="error"
              title="Couldn't load activity"
              :description="apiErrorMessage(activityError)"
              appearance="outline"
            >
              <UButton
                label="Retry"
                icon="i-lucide-rotate-cw"
                variant="outline"
                :loading="activityStatus === 'pending'"
                @click="() => loadActivity()"
              />
            </EmptyState>
            <div
              v-else-if="activityStatus !== 'success' && !activity.length"
              class="space-y-5"
              aria-busy="true"
            >
              <div v-for="n in 4" :key="n" class="flex gap-3">
                <USkeleton class="size-6 shrink-0 rounded-full" />
                <div class="flex-1 space-y-1.5">
                  <USkeleton class="h-3 w-20" />
                  <USkeleton class="h-4 w-1/3" />
                  <USkeleton class="h-3 w-1/2" />
                </div>
              </div>
            </div>
            <template v-else>
              <ContactsActivityTimeline v-if="activity.length" :items="activity" />
              <UAlert
                v-if="!hasEmailActivity"
                icon="i-lucide-mail"
                title="No emails sent to this contact yet"
                description="Sends, deliveries, opens and clicks show up here."
              />
            </template>
          </section>
        </div>

        <aside
          class="lg:w-[300px] shrink-0 lg:border-l lg:border-default lg:pl-8"
          aria-label="Contact details"
        >
          <ContactsMetadataRail :contact="contact" />
        </aside>
      </div>
    </template>
  </UDashboardPanel>
</template>
