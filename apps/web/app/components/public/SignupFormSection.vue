<script setup lang="ts">
import type { AlertProps } from '@nuxt/ui'
import type { OptInMode } from '#shared/types/domain'

/** The list whose signup form is shown. */
interface SignupFormList {
  id: string
  name: string
  isPublic: boolean
  optIn: OptInMode
}

/**
 * List detail: hosted signup page link and an embeddable plain-HTML form.
 * Shown to members who can read lists; the "Edit list" shortcut needs list:update.
 * The form resolves the list's organization from its id, so links need no tenant.
 */
const props = defineProps<{ list: SignupFormList }>()

const emit = defineEmits<{ edit: [] }>()

const { can } = useOrganization()

const canRead = computed(() => can({ list: ['read'] }))
const canEdit = computed(() => can({ list: ['update'] }))

const privateActions = computed<AlertProps['actions']>(() =>
  canEdit.value
    ? [{ label: 'Edit list', variant: 'outline', size: 'sm', onClick: () => emit('edit') }]
    : undefined
)

const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const origin = computed(
  () => String(config.public.siteUrl || '').replace(/\/+$/, '') || requestUrl.origin
)

const hostedUrl = computed(() => `${origin.value}/subscribe/${props.list.id}`)

const snippet = computed(() => {
  const name = props.list.name.replace(/[<>&"]/g, '')

  return `<form action="${origin.value}/api/public/subscribe" method="post" class="nulist-signup">
  <input type="hidden" name="listId" value="${props.list.id}">
  <label for="nulist-email">Email</label>
  <input id="nulist-email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
  <label for="nulist-first-name">First name (optional)</label>
  <input id="nulist-first-name" type="text" name="firstName" autocomplete="given-name">
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <input type="text" name="website" tabindex="-1" autocomplete="off">
  </div>
  <button type="submit">Subscribe to ${name}</button>
</form>`
})
</script>

<template>
  <section
    v-if="canRead"
    class="flex flex-col gap-4 border-t border-default pt-6"
    aria-labelledby="signup-form-heading"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <h2 id="signup-form-heading" class="text-base font-semibold text-highlighted">
          Signup form
        </h2>
        <p class="text-sm text-muted text-pretty">
          Collect subscribers with the hosted page, or paste the form into your website.
          <template v-if="list.optIn === 'double'">
            New subscribers confirm by email first.
          </template>
        </p>
      </div>
      <UButton
        v-if="list.isPublic"
        :to="hostedUrl"
        target="_blank"
        label="Open hosted page"
        icon="i-lucide-external-link"
        variant="outline"
        size="sm"
      />
    </div>

    <UAlert
      v-if="!list.isPublic"
      icon="i-lucide-lock"
      title="This list is private"
      :description="
        canEdit
          ? 'Only public lists accept signups from the hosted page and embedded forms.'
          : 'Only public lists accept signups from the hosted page and embedded forms. Ask an admin to make it public.'
      "
      :actions="privateActions"
    />

    <UCard
      v-else
      :ui="{
        header: 'flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4',
        body: 'flex flex-col gap-2'
      }"
    >
      <template #header>
        <p class="w-28 shrink-0 text-[13px] font-medium text-highlighted">Hosted page</p>
        <CopyText :value="hostedUrl" class="min-w-0" />
      </template>

      <p class="text-[13px] font-medium text-highlighted">Embed code</p>
      <CodeBlock :code="snippet" label="Embed code" max-height="16rem" />
      <p class="text-xs text-muted text-pretty">
        Plain HTML, no script: style it with your site's CSS. Visitors land on the hosted
        confirmation page after submitting. Signups are limited to 5 per minute per visitor.
      </p>
    </UCard>
  </section>
</template>
