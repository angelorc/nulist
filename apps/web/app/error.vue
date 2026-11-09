<script setup lang="ts">
import type { NuxtError } from '#app'
import type { EmptyStateVariant } from '~/components/EmptyState.vue'

/**
 * Error page. Signed-in users keep the dashboard shell (a 403 from a page
 * guard shows the "no permission" state inside it); signed-out visitors and
 * public pages get the plain auth frame.
 */
const props = defineProps<{ error: NuxtError }>()

interface ErrorContent {
  variant: EmptyStateVariant
  /** Short page name for the navbar and the browser tab. */
  heading: string
  title: string
  description: string
}

const { loggedIn } = useUserSession()
const organization = useOrganization()

const status = computed(() => props.error.statusCode)
const layout = computed(() => (loggedIn.value && organization.loaded.value ? 'default' : 'auth'))

const content = computed<ErrorContent>(() => {
  if (status.value === 403)
    return {
      variant: 'forbidden',
      heading: 'No access',
      title: "You don't have permission",
      description:
        props.error.message && props.error.message !== 'Forbidden'
          ? props.error.message
          : 'Your role in this organization does not allow this. Ask an owner or admin for access.'
    }

  if (status.value === 404)
    return {
      variant: 'no-results',
      heading: 'Not found',
      title: 'Page not found',
      description: "The page you're looking for doesn't exist or was moved."
    }

  return {
    variant: 'error',
    heading: 'Error',
    title: 'Something went wrong',
    description: props.error.message || 'An unexpected error occurred. Try again in a moment.'
  }
})

// app.vue (and its title template) does not render around the error page.
useHead({ titleTemplate: (title) => (title ? `${title} · nulist` : 'nulist') })

useSeoMeta({ title: () => content.value.title })

function goHome() {
  return clearError({ redirect: '/' })
}

function signIn() {
  return clearError({ redirect: '/login' })
}
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right', duration: 4000 }" :tooltip="{ delayDuration: 300 }">
    <NuxtLayout :name="layout">
      <UDashboardPanel v-if="layout === 'default'" id="error">
        <template #header>
          <UDashboardNavbar :title="content.heading">
            <template #leading>
              <UDashboardSidebarCollapse />
            </template>
          </UDashboardNavbar>
        </template>
        <template #body>
          <EmptyState
            :variant="content.variant"
            :title="content.title"
            :description="content.description"
          >
            <UButton label="Go to dashboard" variant="outline" @click="goHome" />
          </EmptyState>
        </template>
      </UDashboardPanel>

      <UPageCard v-else class="w-full">
        <EmptyState
          :variant="content.variant"
          :title="content.title"
          :description="content.description"
          compact
        >
          <UButton v-if="loggedIn" label="Go to dashboard" variant="outline" @click="goHome" />
          <UButton v-else label="Sign in" variant="outline" @click="signIn" />
        </EmptyState>
      </UPageCard>
    </NuxtLayout>
  </UApp>
</template>
