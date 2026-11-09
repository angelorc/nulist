<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent, TableColumn, TableRow } from '@nuxt/ui'
import { z } from 'zod'
import { WebhooksDeliverySlideover } from '#components'
import {
  WEBHOOK_DELIVERY_STATUSES,
  endpointFormToInput,
  isWebhookEventType,
  webhookEndpointFormSchema
} from '#shared/schemas/webhooks'
import type {
  WebhookDeliveryStatus,
  WebhookEndpointForm,
  WebhookEndpointUpdate
} from '#shared/schemas/webhooks'

definePageMeta({ permission: { webhook: ['read'] } })

const route = useRoute()
const id = String(route.params.id)

const { can } = useOrganization()
const canEdit = computed(() => can({ webhook: ['update'] }))
const canDelete = computed(() => can({ webhook: ['delete'] }))
const editDenied = "You don't have permission to change endpoints"

const {
  data: endpoint,
  error,
  refresh: refreshEndpoint
} = await useFetch(`/api/webhook-endpoints/${id}`, { key: `webhook-endpoint-${id}` })

if (error.value) {
  const missing = error.value.statusCode === 404 || error.value.statusCode === 422
  throw createError({
    statusCode: missing ? 404 : 500,
    statusMessage: missing ? 'Endpoint not found' : 'Could not load the endpoint',
    fatal: true
  })
}

const title = computed(() => {
  if (!endpoint.value) return 'Endpoint'

  try {
    const url = new URL(endpoint.value.url)

    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return endpoint.value.url
  }
})

useSeoMeta({ title: () => title.value })

const { number, percent } = useFormat()
const confirm = useConfirm()
const overlay = useOverlay()
const deliverySlideover = overlay.create(WebhooksDeliverySlideover)

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------
type DeliveryFilters = { status: string | undefined }

interface DeliveryRow {
  id: string
  eventType: string
  status: WebhookDeliveryStatus
  attempts: number
  responseStatus: number | null
  durationMs: number | null
  lastAttemptAt: string | null
  createdAt: string
}

const {
  page,
  pageSize,
  filters,
  items,
  total,
  loading,
  error: deliveriesError,
  isFiltered,
  clearFilters,
  refresh: refreshDeliveries
} = usePaginatedList<DeliveryRow, DeliveryFilters>(`/api/webhook-deliveries?endpointId=${id}`, {
  filters: { status: undefined },
  key: `webhook-deliveries-${id}`
})

const statusItems = [
  { label: 'All statuses', value: 'all' },
  ...WEBHOOK_DELIVERY_STATUSES.map((value) => ({
    label: value[0]!.toUpperCase() + value.slice(1),
    value
  }))
]

const hasPending = computed(() => items.value.some((d) => d.status === 'pending'))

const { pause, resume } = useIntervalFn(
  async () => {
    await Promise.all([refreshDeliveries(), refreshEndpoint()])
  },
  3000,
  { immediate: false }
)

watch(hasPending, (value) => (value ? resume() : pause()), { immediate: true })

async function openDelivery(delivery: DeliveryRow) {
  const changed = await deliverySlideover.open({ deliveryId: delivery.id }).result

  if (changed) await Promise.all([refreshDeliveries(), refreshEndpoint()])
}

const StatusBadge = resolveComponent('StatusBadge')
const TimeAgo = resolveComponent('TimeAgo')

/** Response codes outside 2xx stand out; a 2xx stays quiet. */
function httpClass(code: number) {
  return code >= 200 && code < 300 ? 'text-muted' : 'text-error font-medium'
}

const columns: TableColumn<DeliveryRow>[] = [
  {
    accessorKey: 'eventType',
    header: 'Event',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'font-mono text-xs font-medium text-highlighted truncate' },
        row.original.eventType
      )
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { class: { th: 'w-28', td: 'w-28' } },
    cell: ({ row }) => h(StatusBadge, { status: row.original.status })
  },
  {
    accessorKey: 'responseStatus',
    header: 'HTTP',
    meta: {
      class: { th: 'w-20 text-right', td: 'w-20 text-right tabular-nums font-mono text-xs' }
    },
    cell: ({ row }) => {
      const code = row.original.responseStatus

      return code === null ? emptyCell() : h('span', { class: httpClass(code) }, code)
    }
  },
  {
    accessorKey: 'attempts',
    header: 'Attempts',
    meta: {
      class: {
        th: 'w-24 hidden sm:table-cell text-right',
        td: 'w-24 hidden sm:table-cell text-right tabular-nums text-muted'
      }
    },
    cell: ({ row }) => number(row.original.attempts)
  },
  {
    accessorKey: 'durationMs',
    header: 'Duration',
    meta: {
      class: {
        th: 'w-24 hidden md:table-cell text-right',
        td: 'w-24 hidden md:table-cell text-right tabular-nums text-muted'
      }
    },
    cell: ({ row }) =>
      row.original.durationMs === null ? emptyCell() : `${number(row.original.durationMs)} ms`
  },
  {
    accessorKey: 'createdAt',
    header: 'Time',
    meta: { class: { th: 'w-32', td: 'w-32 text-muted' } },
    cell: ({ row }) => h(TimeAgo, { date: row.original.createdAt })
  }
]

function onSelect(_event: Event, row: TableRow<DeliveryRow>) {
  void openDelivery(row.original)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const { run: sendTest, pending: testing } = useApiAction(
  () => $fetch<unknown>(`/api/webhook-endpoints/${id}/test`, { method: 'POST' }),
  { success: 'Test event queued' }
)

async function onTest() {
  if ((await sendTest()) === undefined) return
  tab.value = 'deliveries'
  filters.status = undefined
  page.value = 1
  await Promise.all([refreshDeliveries(), refreshEndpoint()])
}

const { run: patch, pending: saving } = useApiAction((body: WebhookEndpointUpdate) =>
  $fetch<unknown>(`/api/webhook-endpoints/${id}`, { method: 'PATCH', body })
)

const notify = useNotify()

async function toggleEnabled(value: boolean) {
  if (!endpoint.value) return
  const previous = endpoint.value.enabled
  endpoint.value.enabled = value
  const row = await patch({ enabled: value })

  if (row === undefined) {
    endpoint.value.enabled = previous

    return
  }

  notify.success(value ? 'Endpoint enabled' : 'Endpoint disabled')
}

const { run: remove } = useApiAction(
  () => $fetch<unknown>(`/api/webhook-endpoints/${id}`, { method: 'DELETE' }),
  { success: 'Endpoint deleted' }
)

async function onDelete() {
  const ok = await confirm({
    title: 'Delete this endpoint?',
    description: `${endpoint.value?.url} stops receiving events and its delivery history is deleted. This can't be undone.`,
    confirmLabel: 'Delete endpoint',
    danger: true
  })

  if (ok && (await remove()) !== undefined) await navigateTo('/webhooks')
}

/** The navbar's `…` menu: Delete, alone in its destructive group (DESIGN.md §5). */
const moreItems = computed<DropdownMenuItem[][]>(() =>
  canDelete.value
    ? [[{ label: 'Delete endpoint', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }]]
    : []
)

function onRotated(secret: string) {
  if (endpoint.value) endpoint.value.secret = secret
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function toState(): WebhookEndpointForm {
  const events = (endpoint.value?.events ?? []).filter(isWebhookEventType)

  return {
    url: endpoint.value?.url ?? '',
    description: endpoint.value?.description ?? '',
    allEvents: events.length === 0,
    events: [...events]
  }
}

const config = reactive<WebhookEndpointForm>(toState())
const saved = ref(JSON.stringify(toState()))
const dirty = computed(() => JSON.stringify(config) !== saved.value)

function resetConfig() {
  Object.assign(config, toState())
  saved.value = JSON.stringify(toState())
}

async function saveConfig(event: FormSubmitEvent<WebhookEndpointForm>) {
  const row = await patch(endpointFormToInput(event.data))

  if (row === undefined) return
  notify.success('Endpoint updated')
  await refreshEndpoint()
  resetConfig()
}

const configForm = useTemplateRef<{ submit: () => Promise<void> }>('configForm')

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const sectionSchema = z.enum(['deliveries', 'configuration', 'verify'])

type Section = z.infer<typeof sectionSchema>

const tab = ref<Section>('deliveries')

function onTab(value: string | number) {
  const parsed = sectionSchema.safeParse(value)

  if (parsed.success) tab.value = parsed.data
}

const tabs = [
  { label: 'Deliveries', value: 'deliveries', icon: 'i-lucide-history' },
  { label: 'Configuration', value: 'configuration', icon: 'i-lucide-sliders-horizontal' },
  { label: 'Verify requests', value: 'verify', icon: 'i-lucide-shield-check' }
]

const eventsSummary = computed(() => {
  const count = endpoint.value?.events.length ?? 0

  return count === 0 ? 'All events' : `${count} of ${WEBHOOK_EVENTS.length} events`
})

// ⌘S saves the configuration while it is open and changed (DESIGN.md §5).
defineShortcuts(
  computed(() => ({
    meta_s:
      tab.value === 'configuration' && canEdit.value && dirty.value
        ? { usingInput: true, handler: () => void configForm.value?.submit() }
        : false
  }))
)
</script>

<template>
  <UDashboardPanel id="webhook-detail">
    <template #header>
      <UDashboardNavbar :title="title" :ui="{ title: 'font-mono text-sm' }">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/webhooks"
            aria-label="Back to webhooks"
          />
        </template>
        <template #trailing>
          <StatusBadge
            :status="endpoint?.enabled ? 'active' : 'disabled'"
            :label="endpoint?.enabled ? 'Enabled' : 'Disabled'"
          />
        </template>
        <template #right>
          <Can v-slot="{ allowed }" :permission="{ webhook: ['update'] }" :explain="editDenied">
            <UButton
              label="Send test event"
              aria-label="Send test event"
              icon="i-lucide-send"
              :ui="{ label: 'hidden sm:inline' }"
              :loading="testing"
              :disabled="!allowed || !endpoint?.enabled"
              @click="onTest"
            />
          </Can>
          <UDropdownMenu v-if="moreItems.length" :items="moreItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More endpoint actions" />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <UTabs
            :model-value="tab"
            :items="tabs"
            size="sm"
            :content="false"
            aria-label="Endpoint sections"
            @update:model-value="onTab"
          />
        </template>
        <template v-if="tab === 'deliveries'" #right>
          <span
            v-if="hasPending"
            class="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted"
            role="status"
          >
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            Updating live
          </span>
          <USelect
            v-model="filters.status"
            :items="statusItems"
            placeholder="All statuses"
            size="sm"
            class="w-32"
            aria-label="Filter deliveries by status"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div v-if="endpoint" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div class="min-w-0 space-y-4">
          <p class="font-mono text-xs text-muted break-all">
            {{ endpoint.url }}
            <span v-if="endpoint.description" class="font-sans text-[13px]">
              · {{ endpoint.description }}</span
            >
          </p>

          <!-- Deliveries -->
          <div v-show="tab === 'deliveries'" class="space-y-3">
            <EmptyState
              v-if="deliveriesError"
              variant="error"
              title="Couldn't load deliveries"
              :description="apiErrorMessage(deliveriesError)"
              appearance="outline"
            >
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                variant="outline"
                @click="() => refreshDeliveries()"
              />
            </EmptyState>
            <UTable
              v-else-if="loading || items.length"
              :data="items"
              :columns="columns"
              :loading="loading && !items.length"
              :ui="tableUi"
              class="shrink-0"
              @select="onSelect"
            />
            <EmptyState
              v-else-if="isFiltered"
              variant="no-results"
              title="No deliveries match this filter"
              description="Try another status."
              appearance="outline"
            >
              <UButton label="Clear filters" variant="outline" @click="clearFilters" />
            </EmptyState>
            <EmptyState
              v-else
              icon="i-lucide-send"
              title="No deliveries yet"
              :description="
                canEdit
                  ? 'Deliveries appear here when a subscribed event happens. Send a test event to try your receiver.'
                  : 'Deliveries appear here when a subscribed event happens.'
              "
              appearance="outline"
            >
              <UButton
                v-if="canEdit"
                label="Send test event"
                icon="i-lucide-send"
                variant="outline"
                :loading="testing"
                :disabled="!endpoint.enabled"
                @click="onTest"
              />
            </EmptyState>

            <TableFooter
              v-model:page="page"
              :total="total"
              :page-size="pageSize"
              noun="delivery"
              noun-plural="deliveries"
            />
          </div>

          <!-- Configuration -->
          <div v-show="tab === 'configuration'">
            <UForm
              id="endpoint-config"
              ref="configForm"
              :schema="webhookEndpointFormSchema"
              :state="config"
              :disabled="!canEdit"
              class="space-y-5 max-w-2xl"
              @submit="saveConfig"
            >
              <UAlert
                v-if="!canEdit"
                icon="i-lucide-lock"
                description="You don't have permission to change endpoints."
              />
              <UFormField label="Endpoint URL" name="url" required>
                <UInput
                  v-model="config.url"
                  type="url"
                  class="w-full"
                  :ui="{ base: 'font-mono text-[13px]' }"
                />
              </UFormField>
              <UFormField label="Description" name="description">
                <UInput v-model="config.description" placeholder="CRM sync" class="w-full" />
              </UFormField>
              <UFormField label="Events" name="events">
                <WebhooksEventPicker
                  v-model:all="config.allEvents"
                  v-model:events="config.events"
                  :disabled="!canEdit"
                />
              </UFormField>
              <div v-if="canEdit" class="flex items-center justify-end gap-2 pt-1">
                <UButton v-if="dirty" label="Discard" variant="ghost" @click="resetConfig" />
                <UTooltip text="Save changes" :kbds="['meta', 's']" :disabled="!dirty">
                  <UButton
                    type="submit"
                    label="Save changes"
                    :loading="saving"
                    :disabled="!dirty"
                  />
                </UTooltip>
              </div>
            </UForm>
          </div>

          <!-- Verify -->
          <div v-show="tab === 'verify'" class="max-w-3xl">
            <WebhooksVerificationSnippet />
          </div>
        </div>

        <aside
          class="rounded-lg ring ring-default divide-y divide-default lg:sticky lg:top-0"
          aria-label="Endpoint details"
        >
          <div class="p-4">
            <USwitch
              v-if="canEdit"
              :model-value="endpoint.enabled"
              label="Enabled"
              description="Disabled endpoints receive nothing; queued retries fail."
              :disabled="saving"
              @update:model-value="toggleEnabled"
            />
            <div v-else class="flex items-center justify-between">
              <span class="text-[13px] text-muted">Status</span>
              <StatusBadge
                :status="endpoint.enabled ? 'active' : 'disabled'"
                :label="endpoint.enabled ? 'Enabled' : 'Disabled'"
              />
            </div>
          </div>

          <div class="p-4 space-y-2">
            <p class="text-[13px] font-medium text-highlighted">Signing secret</p>
            <WebhooksSigningSecret
              :endpoint-id="endpoint.id"
              :secret="endpoint.secret"
              :can-manage="canEdit"
              @rotated="onRotated"
            />
          </div>

          <div class="p-4 space-y-3">
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-[13px] font-medium text-highlighted">Success rate</p>
              <p class="text-xs text-muted">
                last {{ number(Math.max(endpoint.stats.total, 0)) }} deliveries
              </p>
            </div>
            <p
              class="text-[28px] leading-8 font-semibold tracking-tight text-highlighted tabular-nums"
            >
              {{ endpoint.stats.successRate === null ? '—' : percent(endpoint.stats.successRate) }}
            </p>
            <div
              v-if="endpoint.stats.total"
              class="flex h-1.5 overflow-hidden rounded-full bg-elevated"
              role="img"
              :aria-label="`${endpoint.stats.success} succeeded, ${endpoint.stats.failed} failed, ${endpoint.stats.pending} pending`"
            >
              <div
                class="bg-success"
                :style="{ width: `${(endpoint.stats.success / endpoint.stats.total) * 100}%` }"
              />
              <div
                class="bg-error"
                :style="{ width: `${(endpoint.stats.failed / endpoint.stats.total) * 100}%` }"
              />
              <div
                class="bg-warning"
                :style="{ width: `${(endpoint.stats.pending / endpoint.stats.total) * 100}%` }"
              />
            </div>
            <dl class="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt class="text-muted">Succeeded</dt>
                <dd class="text-highlighted tabular-nums">
                  {{ number(endpoint.stats.success) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Failed</dt>
                <dd class="text-highlighted tabular-nums">
                  {{ number(endpoint.stats.failed) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Pending</dt>
                <dd class="text-highlighted tabular-nums">
                  {{ number(endpoint.stats.pending) }}
                </dd>
              </div>
            </dl>
          </div>

          <dl
            class="p-4 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]"
          >
            <dt class="text-muted">Events</dt>
            <dd>
              <UButton
                :label="eventsSummary"
                variant="link"
                size="sm"
                class="p-0"
                @click="tab = 'configuration'"
              />
            </dd>
            <dt class="text-muted">Last delivery</dt>
            <dd class="text-highlighted">
              <TimeAgo :date="endpoint.stats.lastDeliveryAt" fallback="Never" />
            </dd>
            <dt class="text-muted">Created</dt>
            <dd class="text-highlighted">
              <TimeAgo :date="endpoint.createdAt" />
            </dd>
            <dt class="text-muted">ID</dt>
            <dd class="flex min-w-0">
              <CopyText :value="endpoint.id" />
            </dd>
          </dl>
        </aside>
      </div>
    </template>
  </UDashboardPanel>
</template>
