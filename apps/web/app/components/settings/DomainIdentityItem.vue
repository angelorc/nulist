<script setup lang="ts">
import type { DomainCheckResult, DomainIdentity } from '#shared/schemas/domains'

/**
 * One SES identity: summary row that expands into DNS records, live checks and
 * MAIL FROM setup. MAIL FROM needs `canUpdate`, removal `canDelete`; checks are read-only.
 */
const props = defineProps<{ identity: DomainIdentity; canUpdate: boolean; canDelete: boolean }>()
const emit = defineEmits<{ updated: [identity: DomainIdentity]; removed: [name: string] }>()
const open = defineModel<boolean>('open', { default: false })

const isDomain = computed(() => props.identity.type === 'domain')

const subtitle = computed(() => {
  if (!isDomain.value) return 'Email address identity'
  const parts = [`${props.identity.dkim.tokens.length} DKIM keys`]
  parts.push(
    props.identity.mailFrom.domain
      ? `MAIL FROM ${props.identity.mailFrom.domain}`
      : 'Default MAIL FROM'
  )

  return parts.join(' · ')
})

// Live DNS checks ---------------------------------------------------------------
const check = ref<DomainCheckResult | null>(null)
const checking = ref(false)
const checkError = ref<string | null>(null)

async function runCheck() {
  checking.value = true
  checkError.value = null

  try {
    check.value = await $fetch<DomainCheckResult>('/api/domains/check', {
      method: 'POST',
      body: {
        domain: props.identity.name,
        dkimTokens: props.identity.dkim.tokens,
        mailFromDomain: props.identity.mailFrom.domain ?? ''
      }
    })
  } catch (error) {
    checkError.value = apiErrorMessage(error)
  } finally {
    checking.value = false
  }
}

watch(
  open,
  (value) => {
    if (value && isDomain.value && !check.value && !checking.value) void runCheck()
  },
  { immediate: true }
)

function onMailFromSaved(identity: DomainIdentity) {
  emit('updated', identity)
  check.value = null
  void runCheck()
}

// Removal ------------------------------------------------------------------------
const confirm = useConfirm()

const { run: remove, pending: removing } = useApiAction(
  () => {
    const url: string = `/api/domains/${encodeURIComponent(props.identity.name)}`

    return $fetch<unknown>(url, { method: 'DELETE' })
  },
  { success: `${props.identity.name} removed`, error: 'Could not remove the identity' }
)

async function onRemove() {
  if (!props.canDelete) return

  const ok = await confirm({
    title: `Remove ${props.identity.name}?`,
    description:
      'Amazon SES stops accepting mail from this identity until you add it again. DNS records at your provider are not changed.',
    confirmLabel: 'Remove from SES',
    danger: true
  })

  if (ok && (await remove()) !== undefined) emit('removed', props.identity.name)
}
</script>

<template>
  <UCollapsible v-model:open="open">
    <UButton
      variant="ghost"
      block
      trailing-icon="i-lucide-chevron-down"
      class="group gap-3 rounded-none px-4 py-3 text-start justify-start"
      :ui="{
        trailingIcon:
          'size-4 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none'
      }"
    >
      <template #leading>
        <UAvatar
          :icon="isDomain ? 'i-lucide-globe' : 'i-lucide-at-sign'"
          size="md"
          class="rounded-md bg-elevated ring ring-default"
          :ui="{ icon: 'size-4 text-muted' }"
        />
      </template>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-highlighted">{{ identity.name }}</span>
        <span class="block truncate text-xs font-normal text-muted">{{ subtitle }}</span>
      </span>
      <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
        <SettingsIdentityStatusBadge :status="identity.status" />
        <SettingsIdentityStatusBadge v-if="isDomain" :status="identity.dkim.status" prefix="DKIM" />
      </span>
    </UButton>

    <template #content>
      <div class="border-t border-default bg-elevated/20 px-4 py-5 space-y-6">
        <div class="flex sm:hidden flex-wrap gap-1.5">
          <SettingsIdentityStatusBadge :status="identity.status" />
          <SettingsIdentityStatusBadge
            v-if="isDomain"
            :status="identity.dkim.status"
            prefix="DKIM"
          />
        </div>

        <template v-if="isDomain">
          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-highlighted">DNS records</h3>
              <p class="text-[13px] text-muted">
                Publish these at your DNS provider. SES usually verifies within minutes; it can take
                up to 72 hours.
              </p>
            </div>
            <SettingsDnsRecordsTable :records="identity.records" :domain="identity.name" />
          </section>

          <section class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-highlighted">DNS health</h3>
                <p class="text-[13px] text-muted">
                  What public DNS returns right now for SPF, DKIM, DMARC and MAIL FROM.
                </p>
              </div>
              <UButton
                label="Check again"
                icon="i-lucide-refresh-cw"
                variant="ghost"
                size="sm"
                :loading="checking"
                @click="runCheck"
              />
            </div>
            <div v-if="checking && !check" class="space-y-2" aria-busy="true">
              <span class="sr-only">Checking DNS records</span>
              <USkeleton v-for="i in 4" :key="i" class="h-14 w-full" />
            </div>
            <UAlert
              v-else-if="checkError"
              color="error"
              icon="i-lucide-circle-alert"
              title="DNS check failed"
              :description="checkError"
            />
            <SettingsDnsCheckList
              v-else-if="check"
              :result="check"
              :class="checking && 'opacity-60'"
            />
          </section>

          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-highlighted">Custom MAIL FROM</h3>
              <p class="text-[13px] text-muted">
                Bounces return to a subdomain you own, so SPF aligns with your domain for DMARC. Add
                the MX and SPF records shown above after saving.
              </p>
            </div>
            <SettingsMailFromForm
              :identity="identity"
              :disabled="!canUpdate"
              @saved="onMailFromSaved"
            />
          </section>
        </template>

        <div v-if="canDelete" class="flex justify-end pt-4 border-t border-default">
          <UButton
            label="Remove from SES"
            icon="i-lucide-trash"
            color="error"
            variant="soft"
            :loading="removing"
            @click="onRemove"
          />
        </div>
      </div>
    </template>
  </UCollapsible>
</template>
