<script setup lang="ts">
import type { Paginated } from '#shared/types/domain'
import type { EmailLogItem } from '#shared/types/logs'

const { organization } = useOrganization()

const { data, status, error, refresh } = useFetch<Paginated<EmailLogItem>>('/api/logs/emails', {
  key: () => `dashboard-issues:${organization.value?.id ?? 'none'}`,
  query: { outcome: 'issues', pageSize: 5 },
  lazy: true,
  server: false
})

const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <DashboardSection
    title="Delivery issues"
    description="Latest bounces, complaints and failures"
    flush
  >
    <template #actions>
      <UButton
        label="View all"
        trailing-icon="i-lucide-arrow-right"
        variant="ghost"
        size="sm"
        to="/logs?outcome=issues"
      />
    </template>

    <div v-if="status === 'pending' && !data" class="space-y-2 p-4" aria-busy="true">
      <USkeleton v-for="n in 4" :key="n" class="h-10 w-full" />
    </div>
    <EmptyState
      v-else-if="error"
      variant="error"
      title="Delivery issues could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton label="Retry" variant="outline" size="sm" @click="() => refresh()" />
    </EmptyState>
    <EmptyState
      v-else-if="!items.length"
      icon="i-lucide-circle-check"
      title="No delivery issues"
      description="Bounced, complained, failed and rejected emails show up here."
      compact
    />
    <ul v-else class="divide-y divide-default border-t border-default">
      <li v-for="item in items" :key="item.id">
        <ULink
          :to="`/logs?tab=emails&id=${item.id}`"
          class="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50 focus-visible:bg-elevated/50 focus-visible:outline-none transition-colors"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-xs text-highlighted">{{
              item.toEmail
            }}</span>
            <span class="block truncate text-xs text-muted">{{ item.error ?? item.subject }}</span>
          </span>
          <StatusBadge :status="item.status" />
          <span class="w-20 shrink-0 text-right text-xs text-muted">
            <TimeAgo :date="item.sentAt ?? item.createdAt" />
          </span>
        </ULink>
      </li>
    </ul>
  </DashboardSection>
</template>
