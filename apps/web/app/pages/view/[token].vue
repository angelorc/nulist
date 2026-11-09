<script setup lang="ts">
import type { WebViewMeta } from '#shared/schemas/public'

// Full-viewport reader: the email needs the whole width, so no centered public layout.
definePageMeta({ layout: false })

useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const token = String(route.params.token ?? '')
const metaUrl: string = `/api/public/view/${token}/meta`
const frameUrl = `/api/public/view/${token}`

const {
  data: meta,
  error,
  refresh
} = await useFetch<WebViewMeta>(metaUrl, { key: `web-view-${token}` })

useSeoMeta({ title: () => meta.value?.subject || 'View email', robots: 'noindex, nofollow' })

/** The frame fired `load`: the skeleton gives way to the email. */
const loaded = ref(false)

const invalid = computed(() => {
  const code = error.value?.statusCode ?? 0

  return code >= 400 && code < 500
})
</script>

<template>
  <div class="h-dvh flex flex-col bg-default">
    <header class="shrink-0 flex min-h-12 items-center gap-3 border-b border-default px-4 py-2">
      <UIcon
        name="i-lucide-mail"
        class="hidden size-4 shrink-0 text-muted sm:block"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
        <h1 v-if="meta" class="truncate text-sm font-medium text-highlighted">
          {{ meta.subject || 'Email' }}
        </h1>
        <!-- Without the email, the status below is the page's heading. -->
        <p v-else class="truncate text-sm font-medium text-highlighted">Email</p>
        <p v-if="meta" class="truncate text-xs text-muted">
          {{ meta.from
          }}<template v-if="meta.sentAt">
            ·
            <NuxtTime
              :datetime="meta.sentAt"
              locale="en-GB"
              date-style="medium"
              time-style="short"
            />
          </template>
        </p>
      </div>
      <UButton
        v-if="meta?.preferencesUrl"
        :to="meta.preferencesUrl"
        label="Preferences"
        icon="i-lucide-sliders-horizontal"
        variant="ghost"
        size="sm"
        class="shrink-0"
        :ui="{ label: 'hidden sm:inline' }"
        aria-label="Email preferences"
      />
    </header>

    <main class="relative flex-1 min-h-0">
      <div v-if="error" class="h-full overflow-y-auto grid place-items-center px-4 py-8">
        <div class="w-full max-w-md">
          <PublicStatus
            v-if="invalid"
            icon="i-lucide-link-2-off"
            tone="error"
            title="This email isn't available"
            description="The link may be incomplete or the email was removed. Open the link from the email again."
          />
          <PublicStatus
            v-else
            icon="i-lucide-triangle-alert"
            tone="error"
            title="Couldn't load this email"
            description="Check your connection and try again."
          >
            <UButton
              label="Try again"
              icon="i-lucide-rotate-cw"
              variant="outline"
              @click="() => refresh()"
            />
          </PublicStatus>
        </div>
      </div>

      <template v-else>
        <!-- Shaped like an email: rendered on the server, removed once the frame has loaded. -->
        <div v-if="!loaded" class="absolute inset-0 overflow-hidden px-4 py-8" aria-busy="true">
          <div class="mx-auto flex max-w-[600px] flex-col gap-4">
            <USkeleton class="h-7 w-28" />
            <USkeleton class="h-40 w-full sm:h-56" />
            <USkeleton class="h-5 w-3/4" />
            <USkeleton class="h-4 w-full" />
            <USkeleton class="h-4 w-full" />
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-9 w-40" />
          </div>
        </div>

        <!-- Client-only so the load listener is attached before the frame starts loading. -->
        <ClientOnly>
          <iframe
            :src="frameUrl"
            :title="meta?.subject || 'Email content'"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            referrerpolicy="no-referrer"
            class="block size-full border-0 bg-white transition-opacity duration-150"
            :class="loaded ? 'opacity-100' : 'opacity-0'"
            @load="loaded = true"
          />
        </ClientOnly>
      </template>
    </main>
  </div>
</template>
