<script setup lang="ts">
import { logTabSchema } from '~/components/logs/Panel.vue'
import type { LogTab } from '~/components/logs/Panel.vue'

definePageMeta({ permission: { log: ['read'] } })

useSeoMeta({ title: 'Logs' })

const route = useRoute()
const router = useRouter()

const tab = computed<LogTab>({
  get: () => logTabSchema.catch('emails').parse(route.query.tab),
  // Filters belong to one view, so switching starts from a clean query.
  set: (value) => router.replace({ query: value === 'emails' ? {} : { tab: value } })
})
</script>

<template>
  <LogsEmailsTab v-if="tab === 'emails'" v-model:tab="tab" />
  <LogsApiRequestsTab v-else-if="tab === 'api'" v-model:tab="tab" />
  <LogsInboundTab v-else v-model:tab="tab" />
</template>
