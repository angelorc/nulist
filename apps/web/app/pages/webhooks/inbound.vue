<script setup lang="ts">
import { WebhooksInboundEventSlideover, WebhooksSimulateEventModal } from '#components'
import {
  INBOUND_STATUSES,
  SES_EVENT_LABELS,
  SES_EVENT_TYPES,
  SIMULATE_SES_EVENT_PERMISSION
} from '#shared/schemas/webhooks'
import type { InboundEventListItem } from '#shared/schemas/webhooks'

definePageMeta({ permission: { webhook: ['read'] } })

useSeoMeta({ title: 'Amazon SES events' })

const { can } = useOrganization()
const canSimulate = computed(() => can(SIMULATE_SES_EVENT_PERMISSION))

type InboundFilters = { eventType: string | undefined; status: string | undefined }

const {
  page,
  pageSize,
  q,
  filters,
  items,
  total,
  loading,
  error,
  refresh,
  isFiltered,
  clearFilters
} = usePaginatedList<InboundEventListItem, InboundFilters>('/api/inbound-events', {
  filters: { eventType: undefined, status: undefined }
})

const eventTypeItems = [
  { label: 'All events', value: 'all' },
  ...SES_EVENT_TYPES.filter((t) => t !== 'Send' && t !== 'Subscription').map((value) => ({
    label: SES_EVENT_LABELS[value],
    value
  }))
]

const statusItems = [
  { label: 'All statuses', value: 'all' },
  ...INBOUND_STATUSES.map((value) => ({ label: value[0]!.toUpperCase() + value.slice(1), value }))
]

const overlay = useOverlay()
const slideover = overlay.create(WebhooksInboundEventSlideover)
const simulateModal = overlay.create(WebhooksSimulateEventModal)

function open(item: InboundEventListItem) {
  slideover.open({ eventId: item.id })
}

async function simulate() {
  if (await simulateModal.open({}).result) await refresh()
}

const search = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

defineShortcuts({ '/': () => search.value?.inputRef?.focus() })
</script>

<template>
  <UDashboardPanel id="webhooks-inbound">
    <template #header>
      <UDashboardNavbar title="Amazon SES events">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/webhooks"
            aria-label="Back to webhooks"
          />
        </template>
        <template #right>
          <UTooltip text="Refresh">
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              aria-label="Refresh events"
              :loading="loading"
              @click="() => refresh()"
            />
          </UTooltip>
          <UButton
            v-if="canSimulate"
            label="Simulate event"
            aria-label="Simulate event"
            icon="i-lucide-flask-conical"
            :ui="{ label: 'hidden sm:inline' }"
            @click="simulate"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'flex-wrap', right: 'ms-auto' }"
      >
        <template #left>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Recipient or message ID…"
            size="sm"
            class="w-full sm:w-64"
            aria-label="Search events"
          >
            <template #trailing>
              <UKbd v-if="!q" value="/" />
              <UButton
                v-else
                icon="i-lucide-x"
                variant="link"
                size="xs"
                aria-label="Clear search"
                @click="q = ''"
              />
            </template>
          </UInput>
          <USelect
            v-model="filters.eventType"
            :items="eventTypeItems"
            placeholder="All events"
            size="sm"
            class="w-40"
            aria-label="Filter by event type"
          />
          <USelect
            v-model="filters.status"
            :items="statusItems"
            placeholder="All statuses"
            size="sm"
            class="w-36"
            aria-label="Filter by status"
          />
        </template>
        <template #right>
          <UButton
            v-if="isFiltered"
            label="Clear filters"
            variant="ghost"
            size="sm"
            @click="clearFilters"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Couldn't load events"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          @click="() => refresh()"
        />
      </EmptyState>
      <WebhooksInboundEventsTable
        v-else-if="loading || items.length"
        :items="items"
        :loading="loading"
        @select="open"
      />
      <EmptyState
        v-else-if="isFiltered"
        variant="no-results"
        title="No events match your filters"
        description="Try another event type or status."
      >
        <UButton label="Clear filters" variant="outline" @click="clearFilters" />
      </EmptyState>
      <EmptyState
        v-else
        icon="i-lucide-radio-tower"
        title="No events received yet"
        description="Connect an SES configuration set to this instance through Amazon SNS. The setup steps are on the Webhooks page."
      >
        <UButton label="View setup steps" variant="outline" to="/webhooks" />
      </EmptyState>

      <TableFooter v-model:page="page" :total="total" :page-size="pageSize" noun="event" />
    </template>
  </UDashboardPanel>
</template>
