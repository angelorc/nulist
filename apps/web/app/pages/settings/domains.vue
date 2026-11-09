<script setup lang="ts">
import type { DomainIdentity, DomainOverview } from '#shared/schemas/domains'
import { SettingsDomainAddModal } from '#components'

definePageMeta({ permission: { domain: ['read'] } })

useSeoMeta({ title: 'Domains' })

const NO_PERMISSION = "You don't have permission to add domains"

const { organization, can } = useOrganization()
const canCreate = computed(() => can({ domain: ['create'] }))
const canUpdate = computed(() => can({ domain: ['update'] }))
const canDelete = computed(() => can({ domain: ['delete'] }))
const canReadSettings = computed(() => can({ settings: ['read'] }))

const { data, status, error, refresh } = useFetch<DomainOverview>('/api/domains', {
  key: () => `domains:${organization.value?.id ?? 'none'}`,
  lazy: true,
  server: false
})

const identities = computed(() => data.value?.identities ?? [])

// Client-only fetch: "no data yet" (not the status) drives the skeleton, so the server render
// and the hydration render agree.
const loading = computed(() => !data.value && !error.value)

/** Which identity row is expanded. Only one at a time keeps the DNS checks focused. */
const expanded = ref<string | null>(null)

function setExpanded(name: string, open: boolean) {
  expanded.value = open ? name : expanded.value === name ? null : expanded.value
}

function upsert(identity: DomainIdentity) {
  if (!data.value) return
  const list = data.value.identities.filter((item) => item.name !== identity.name)
  data.value = { ...data.value, identities: [identity, ...list] }
}

function onRemoved(name: string) {
  if (!data.value) return
  data.value = {
    ...data.value,
    identities: data.value.identities.filter((item) => item.name !== name)
  }

  if (expanded.value === name) expanded.value = null
}

const addModal = useOverlay().create(SettingsDomainAddModal)

async function openAdd() {
  if (!canCreate.value) return

  const identity = await addModal.open().result

  if (!identity) return
  upsert(identity)
  expanded.value = identity.name
}

const summary = computed(() => {
  const domains = identities.value.filter((item) => item.type === 'domain')
  const verified = domains.filter((item) => item.status === 'verified').length

  return { domains: domains.length, verified, emails: identities.value.length - domains.length }
})

defineShortcuts(
  computed(() => ({ n: data.value?.managed && canCreate.value ? () => void openAdd() : false }))
)

const firstDomain = computed(() => identities.value.find((item) => item.type === 'domain')?.name)
</script>

<template>
  <SettingsCard title="Sending domains" stacked>
    <template #description>
      <template v-if="data?.managed">
        Identities in Amazon SES
        <UBadge
          :label="data.region ?? 'region not set'"
          variant="outline"
          class="mx-0.5 font-mono"
        />. Mail can only be sent from verified identities.
      </template>
      <template v-else>
        Verify the domains you send from so receivers can authenticate your mail.
      </template>
    </template>

    <template v-if="data?.managed" #headerActions>
      <Can v-slot="{ allowed }" :permission="{ domain: ['create'] }" :explain="NO_PERMISSION">
        <UTooltip text="Add domain" :kbds="['n']" :disabled="!allowed">
          <UButton label="Add domain" icon="i-lucide-plus" :disabled="!allowed" @click="openAdd" />
        </UTooltip>
      </Can>
    </template>

    <div
      v-if="loading"
      class="divide-y divide-default rounded-lg ring ring-default"
      aria-busy="true"
    >
      <span class="sr-only">Loading domains</span>
      <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
        <USkeleton class="size-8 rounded-md" />
        <div class="flex-1 space-y-1.5">
          <USkeleton class="h-3.5 w-40 max-w-full" />
          <USkeleton class="h-3 w-56 max-w-full" />
        </div>
        <USkeleton class="hidden h-5 w-20 rounded-full sm:block" />
        <USkeleton class="size-4 rounded-sm" />
      </div>
    </div>

    <EmptyState
      v-else-if="error"
      variant="error"
      title="Domains could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </EmptyState>

    <EmptyState
      v-else-if="data && !data.managed"
      icon="i-lucide-key-round"
      :title="
        data.viaSes
          ? 'Add SES API credentials to manage domains here'
          : 'Domain management needs Amazon SES'
      "
      :description="
        data.viaSes
          ? 'You send through the SES SMTP interface. Add an access key with SES permissions in Settings → Sending to add domains and see their DKIM records.'
          : 'Your provider manages domain verification. Use the DNS check below to confirm SPF, DKIM and DMARC are published.'
      "
      compact
    >
      <UButton
        v-if="canReadSettings"
        label="Open sending settings"
        to="/settings/sending"
        variant="outline"
        trailing-icon="i-lucide-arrow-right"
      />
    </EmptyState>

    <EmptyState
      v-else-if="data && !identities.length"
      icon="i-lucide-globe"
      title="No domains yet"
      :description="
        canCreate
          ? 'Add the domain in your from address. You get three DKIM records to publish at your DNS provider.'
          : 'Nobody has added a sending domain to this organization yet.'
      "
      appearance="outline"
      compact
    >
      <UButton
        v-if="canCreate"
        label="Add domain"
        icon="i-lucide-plus"
        variant="outline"
        @click="openAdd"
      />
    </EmptyState>

    <template v-else-if="data">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        <span
          ><span class="font-medium text-highlighted tabular-nums">{{ summary.verified }}</span> of
          {{ summary.domains }} domains verified</span
        >
        <span v-if="summary.emails"
          >{{ summary.emails }} email {{ summary.emails === 1 ? 'address' : 'addresses' }}</span
        >
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          class="ms-auto"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </div>
      <div class="divide-y divide-default overflow-hidden rounded-lg ring ring-default">
        <SettingsDomainIdentityItem
          v-for="identity in identities"
          :key="identity.name"
          :identity="identity"
          :can-update="canUpdate"
          :can-delete="canDelete"
          :open="expanded === identity.name"
          @update:open="(open: boolean) => setExpanded(identity.name, open)"
          @updated="upsert"
          @removed="onRemoved"
        />
      </div>
    </template>
  </SettingsCard>

  <SettingsCard
    title="Check a domain"
    description="Looks up SPF, DKIM, DMARC and MAIL FROM records in public DNS. Works with any provider."
  >
    <SettingsDomainChecker :initial-domain="firstDomain" />
  </SettingsCard>
</template>
