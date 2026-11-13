<script setup lang="ts">
import type { Paginated } from '#shared/types/domain'
import type { AuditLogItem } from '#shared/types/logs'
import type { DateRangeValue } from '~/utils/logLinks'

const props = defineProps<{ range: DateRangeValue }>()

const { organization } = useOrganization()

const rangeQuery = computed(() =>
  LogLinks.query({ period: props.range.period, from: props.range.from, to: props.range.to })
)

const query = computed(() => ({ pageSize: 6, ...rangeQuery.value }))

const { data, status, error, refresh } = useFetch<Paginated<AuditLogItem>>('/api/audit', {
  key: () =>
    `dashboard-activity:${organization.value?.id ?? 'none'}:${Object.values(rangeQuery.value).join(':')}`,
  query,
  lazy: true,
  server: false
})

const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <DashboardSection title="Recent activity" description="Latest changes in this workspace" flush>
    <template #actions>
      <UButton
        label="Audit log"
        trailing-icon="i-lucide-arrow-right"
        variant="ghost"
        size="sm"
        :to="LogLinks.audit({ ...range })"
      />
    </template>

    <div
      v-if="(status === 'idle' || status === 'pending') && !data"
      class="space-y-2 p-4"
      aria-busy="true"
    >
      <USkeleton v-for="n in 5" :key="n" class="h-10 w-full" />
    </div>
    <EmptyState
      v-else-if="error"
      variant="error"
      title="Activity could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton label="Retry" variant="outline" size="sm" @click="() => refresh()" />
    </EmptyState>
    <EmptyState
      v-else-if="!items.length"
      icon="i-lucide-history"
      title="No activity in this period"
      description="Changes to lists, contacts, templates and broadcasts show up here."
      compact
    />
    <ul v-else class="divide-y divide-default border-t border-default">
      <li v-for="entry in items" :key="entry.id">
        <ULink
          :to="LogLinks.audit({ ...range, id: String(entry.id) })"
          class="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50 focus-visible:bg-elevated/50 focus-visible:outline-none transition-colors"
        >
          <span
            class="grid size-7 shrink-0 place-items-center rounded-full bg-elevated ring ring-default"
            aria-hidden="true"
          >
            <UIcon
              :name="auditVerb(entry.action).icon"
              class="size-3.5"
              :class="auditVerb(entry.action).tone ?? 'text-muted'"
            />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] text-highlighted">{{ entry.summary }}</span>
            <span class="block truncate text-xs text-muted">{{
              entry.actorLabel ?? AUDIT_ACTORS[entry.actorType]?.label
            }}</span>
          </span>
          <span class="w-20 shrink-0 text-right text-xs text-muted">
            <TimeAgo :date="entry.createdAt" />
          </span>
        </ULink>
      </li>
    </ul>
  </DashboardSection>
</template>
