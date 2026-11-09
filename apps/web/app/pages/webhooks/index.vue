<script setup lang="ts">
import type { DropdownMenuItem, TableColumn, TableRow } from '@nuxt/ui'
import {
  WebhooksEndpointFormModal,
  WebhooksInboundEventSlideover,
  WebhooksSimulateEventModal
} from '#components'
import { SIMULATE_SES_EVENT_PERMISSION, simulateSesEventSchema } from '#shared/schemas/webhooks'
import type { InboundEventListItem as InboundEventItem } from '#shared/schemas/webhooks'
import type { Paginated } from '#shared/types/domain'

definePageMeta({ permission: { webhook: ['read'] } })

useSeoMeta({ title: 'Webhooks' })

const { can } = useOrganization()
const canCreate = computed(() => can({ webhook: ['create'] }))
const canUpdate = computed(() => can({ webhook: ['update'] }))
const canDelete = computed(() => can({ webhook: ['delete'] }))
const canSimulate = computed(() => can(SIMULATE_SES_EVENT_PERMISSION))
const createDenied = "You don't have permission to add endpoints"

const {
  data: endpoints,
  status,
  error,
  refresh
} = await useFetch('/api/webhook-endpoints', { default: () => [] })

type EndpointRow = NonNullable<typeof endpoints.value>[number]

const {
  data: inbound,
  status: inboundStatus,
  error: inboundError,
  refresh: refreshInbound
} = await useFetch<Paginated<InboundEventItem>>('/api/inbound-events', {
  query: { pageSize: 10 },
  default: () => ({ items: [], total: 0, page: 1, pageSize: 10 })
})

const siteUrl = String(useRuntimeConfig().public.siteUrl || useRequestURL().origin)
const inboundUrl = computed(() => `${siteUrl.replace(/\/+$/, '')}/api/webhooks/ses`)

const { percent, number } = useFormat()
const confirm = useConfirm()
const overlay = useOverlay()
const formModal = overlay.create(WebhooksEndpointFormModal)
const simulateModal = overlay.create(WebhooksSimulateEventModal)
const inboundSlideover = overlay.create(WebhooksInboundEventSlideover)

async function addEndpoint() {
  const created = await formModal.open().result

  if (created) await navigateTo(`/webhooks/${created.id}`)
}

async function simulate(messageId?: string) {
  if (await simulateModal.open({ messageId }).result) await refreshInbound()
}

function openInbound(item: InboundEventItem) {
  inboundSlideover.open({ eventId: item.id })
}

const { run: sendTest } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/webhook-endpoints/${id}/test`, { method: 'POST' }),
  { success: 'Test event queued' }
)

const { run: setEnabled } = useApiAction(
  (id: string, enabled: boolean) =>
    $fetch<{ enabled: boolean }>(`/api/webhook-endpoints/${id}`, {
      method: 'PATCH',
      body: { enabled }
    }),
  {
    success: (row: { enabled: boolean }) => (row.enabled ? 'Endpoint enabled' : 'Endpoint disabled')
  }
)

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/webhook-endpoints/${id}`, { method: 'DELETE' }),
  { success: 'Endpoint deleted' }
)

async function onTest(endpoint: EndpointRow) {
  if ((await sendTest(endpoint.id)) !== undefined) setTimeout(() => refresh(), 1500)
}

async function onToggle(endpoint: EndpointRow) {
  if ((await setEnabled(endpoint.id, !endpoint.enabled)) !== undefined) await refresh()
}

async function onDelete(endpoint: EndpointRow) {
  const ok = await confirm({
    title: 'Delete this endpoint?',
    description: `${endpoint.url} stops receiving events and its delivery history is deleted. This can't be undone.`,
    confirmLabel: 'Delete endpoint',
    danger: true
  })

  if (ok && (await remove(endpoint.id)) !== undefined) await refresh()
}

const ULink = resolveComponent('ULink')
const UTooltip = resolveComponent('UTooltip')
const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

/**
 * Row menu: everyone can open an endpoint; testing, toggling and deleting need permissions.
 * Delete sits alone in the last group (DESIGN.md §5).
 */
function rowActions(endpoint: EndpointRow): DropdownMenuItem[][] {
  const view: DropdownMenuItem[] = [
    { label: 'Open', icon: 'i-lucide-arrow-up-right', to: `/webhooks/${endpoint.id}` }
  ]

  const groups: DropdownMenuItem[][] = [view]

  if (canUpdate.value) {
    view.push({ label: 'Send test event', icon: 'i-lucide-send', onSelect: () => onTest(endpoint) })
    groups.push([
      {
        label: endpoint.enabled ? 'Disable' : 'Enable',
        icon: endpoint.enabled ? 'i-lucide-circle-pause' : 'i-lucide-circle-play',
        onSelect: () => onToggle(endpoint)
      }
    ])
  }

  if (canDelete.value) {
    groups.push([
      {
        label: 'Delete',
        icon: 'i-lucide-trash',
        color: 'error',
        onSelect: () => onDelete(endpoint)
      }
    ])
  }

  return groups
}

function eventsLabel(events: string[]) {
  return events.length === 0
    ? 'All events'
    : `${events.length} ${events.length === 1 ? 'event' : 'events'}`
}

const columns: TableColumn<EndpointRow>[] = [
  {
    accessorKey: 'url',
    header: 'Endpoint',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h(
          ULink,
          {
            to: `/webhooks/${row.original.id}`,
            class:
              'block truncate font-mono text-xs font-medium text-highlighted hover:underline underline-offset-2',
            title: row.original.url
          },
          () => row.original.url
        ),
        row.original.description
          ? h('p', { class: 'text-muted truncate' }, row.original.description)
          : null
      ])
  },
  {
    accessorKey: 'events',
    header: 'Events',
    meta: {
      class: { th: 'w-32 hidden sm:table-cell', td: 'w-32 hidden sm:table-cell text-muted' }
    },
    cell: ({ row }) => {
      const { events } = row.original

      if (!events.length) return eventsLabel(events)

      return h('span', [
        h(UTooltip, { text: events.join(', '), content: { side: 'top' } }, () =>
          h(
            'span',
            { class: 'underline decoration-dotted underline-offset-4' },
            eventsLabel(events)
          )
        ),
        h('span', { class: 'sr-only' }, `: ${events.join(', ')}`)
      ])
    }
  },
  {
    accessorKey: 'enabled',
    header: 'Status',
    meta: { class: { th: 'w-28', td: 'w-28' } },
    cell: ({ row }) =>
      h(StatusBadge, {
        status: row.original.enabled ? 'active' : 'disabled',
        label: row.original.enabled ? 'Enabled' : 'Disabled'
      })
  },
  {
    id: 'successRate',
    header: 'Success rate',
    meta: {
      class: {
        th: 'w-32 hidden md:table-cell text-right',
        td: 'w-32 hidden md:table-cell text-right'
      }
    },
    cell: ({ row }) => {
      const { stats } = row.original

      if (stats.successRate === null)
        return stats.pending ? h('span', { class: 'text-muted' }, 'Pending') : emptyCell()

      const summary = `Last ${number(stats.total)} deliveries: ${number(stats.success)} succeeded, ${number(stats.failed)} failed${stats.pending ? `, ${number(stats.pending)} pending` : ''}`

      return h('span', [
        h(UTooltip, { text: summary }, () =>
          h('span', { class: ['tabular-nums', stats.failed ? 'text-highlighted' : 'text-muted'] }, [
            percent(stats.successRate),
            stats.failed
              ? h('span', { class: 'ms-1.5 text-xs text-error' }, `${number(stats.failed)} failed`)
              : null
          ])
        ),
        h('span', { class: 'sr-only' }, `. ${summary}`)
      ])
    }
  },
  {
    id: 'lastDelivery',
    header: 'Last delivery',
    meta: {
      class: { th: 'w-32 hidden lg:table-cell', td: 'w-32 hidden lg:table-cell text-muted' }
    },
    cell: ({ row }) => h(TimeAgo, { date: row.original.stats.lastDeliveryAt, fallback: 'Never' })
  },
  rowActionsColumn({ items: rowActions, label: (row) => `Actions for ${row.url}` })
]

function onSelect(_event: Event, row: TableRow<EndpointRow>) {
  void navigateTo(`/webhooks/${row.original.id}`)
}

defineShortcuts(computed(() => ({ n: canCreate.value ? () => addEndpoint() : false })))

// Deep link from a message log: /webhooks?simulate=<messageId>
const route = useRoute()

onMounted(() => {
  const messageId = simulateSesEventSchema.shape.messageId.safeParse(route.query.simulate)

  if (canSimulate.value && messageId.success) simulate(messageId.data)
})
</script>

<template>
  <UDashboardPanel id="webhooks">
    <template #header>
      <UDashboardNavbar title="Webhooks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <Can v-slot="{ allowed }" :permission="{ webhook: ['create'] }" :explain="createDenied">
            <UTooltip text="Add endpoint" :kbds="['n']" :disabled="!allowed">
              <UButton
                label="Add endpoint"
                icon="i-lucide-plus"
                :disabled="!allowed"
                @click="addEndpoint"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <section class="space-y-3" aria-labelledby="endpoints-title">
        <div>
          <h2 id="endpoints-title" class="text-base font-semibold text-highlighted">Endpoints</h2>
          <p class="text-sm text-muted">
            Notify your systems about email and contact events. Every request is signed and failed
            deliveries are retried for about a day.
          </p>
        </div>

        <EmptyState
          v-if="error"
          variant="error"
          title="Couldn't load endpoints"
          :description="apiErrorMessage(error)"
          appearance="outline"
        >
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            variant="outline"
            @click="() => refresh()"
          />
        </EmptyState>
        <UTable
          v-else-if="status === 'pending' || endpoints.length"
          :data="endpoints"
          :columns="columns"
          :loading="status === 'pending'"
          :ui="tableUi"
          class="shrink-0"
          @select="onSelect"
        />
        <EmptyState
          v-else
          icon="i-lucide-webhook"
          title="No endpoints yet"
          :description="
            canCreate
              ? 'Add an endpoint to receive signed events when emails are delivered, bounce or get clicked.'
              : 'Endpoints receive signed events when emails are delivered, bounce or get clicked.'
          "
          appearance="outline"
        >
          <UButton
            v-if="canCreate"
            label="Add endpoint"
            icon="i-lucide-plus"
            @click="addEndpoint"
          />
        </EmptyState>
      </section>

      <USeparator />

      <section class="space-y-4" aria-labelledby="ses-title">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 id="ses-title" class="text-base font-semibold text-highlighted">
              Amazon SES events
            </h2>
            <p class="text-sm text-muted max-w-2xl">
              SES reports deliveries, bounces, complaints, opens and clicks through Amazon SNS.
              mlist uses them to update message status, suppress bad addresses and power analytics.
            </p>
          </div>
          <UButton
            v-if="canSimulate"
            label="Simulate event"
            icon="i-lucide-flask-conical"
            variant="outline"
            size="sm"
            @click="simulate()"
          />
        </div>

        <WebhooksSesSetupGuide
          :inbound-url="inboundUrl"
          :default-open="inboundStatus !== 'pending' && inbound.total === 0"
        />

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-[13px] font-medium text-highlighted">Recent events</h3>
            <div class="flex items-center gap-1">
              <UTooltip text="Refresh">
                <UButton
                  icon="i-lucide-refresh-cw"
                  size="xs"
                  variant="ghost"
                  aria-label="Refresh events"
                  :loading="inboundStatus === 'pending'"
                  @click="() => refreshInbound()"
                />
              </UTooltip>
              <UButton
                v-if="inbound.total > inbound.items.length"
                label="View all"
                trailing-icon="i-lucide-arrow-right"
                size="xs"
                variant="ghost"
                to="/webhooks/inbound"
              />
            </div>
          </div>

          <EmptyState
            v-if="inboundError"
            variant="error"
            title="Couldn't load events"
            :description="apiErrorMessage(inboundError)"
            appearance="outline"
            compact
          >
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              variant="outline"
              @click="() => refreshInbound()"
            />
          </EmptyState>
          <WebhooksInboundEventsTable
            v-else-if="inboundStatus === 'pending' || inbound.items.length"
            :items="inbound.items"
            :loading="inboundStatus === 'pending'"
            @select="openInbound"
          />
          <EmptyState
            v-else
            icon="i-lucide-radio-tower"
            title="No events received yet"
            description="Events appear here once SNS confirms the subscription and SES starts publishing."
            appearance="outline"
            compact
          />
        </div>
      </section>
    </template>
  </UDashboardPanel>
</template>
