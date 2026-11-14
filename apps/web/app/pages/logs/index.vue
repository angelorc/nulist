<script setup lang="ts">
import { logTabSchema } from '~/components/logs/Panel.vue'
import type { LogTab } from '~/components/logs/Panel.vue'

definePageMeta({ permission: { log: ['read'] } })

useSeoMeta({ title: 'Logs' })

const route = useRoute()
const router = useRouter()

const tab = computed<LogTab>({
  get: () => logTabSchema.catch('emails').parse(route.query.tab),
  // Filters belong to one view, so switching keeps only the date range.
  set: (value) => {
    const { period, from, to } = route.query

    void router.replace({
      query: { tab: value === 'emails' ? undefined : value, period, from, to }
    })
  }
})
</script>

<template>
  <LogsEmailsTab v-if="tab === 'emails'" v-model:tab="tab" />
  <LogsApiRequestsTab v-else-if="tab === 'api'" v-model:tab="tab" />
  <LogsInboundTab v-else v-model:tab="tab" />
</template>
