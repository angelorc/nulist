<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'
import { parseJsonBody } from '#shared/schemas/webhooks'
import type { WebhookDeliveryDetail } from '#shared/schemas/webhooks'

const props = defineProps<{ deliveryId: string }>()
const emit = defineEmits<{ close: [changed: boolean] }>()

const { can } = useOrganization()
const canRedeliver = computed(() => can({ webhook: ['update'] }))

const url: string = `/api/webhook-deliveries/${props.deliveryId}`

const {
  data: delivery,
  status,
  error,
  refresh
} = useFetch<WebhookDeliveryDetail>(url, { key: `webhook-delivery-${props.deliveryId}` })

const changed = ref(false)
const { number } = useFormat()

const { run: redeliver, pending: redelivering } = useApiAction(
  () =>
    $fetch<unknown>(`/api/webhook-deliveries/${props.deliveryId}/redeliver`, { method: 'POST' }),
  { success: 'Delivery queued again' }
)

async function onRedeliver() {
  if ((await redeliver()) === undefined) return
  changed.value = true
  await refresh()
}

// Follow an in-flight attempt until it settles.
const { pause, resume } = useIntervalFn(() => refresh(), 2000, { immediate: false })

watch(
  () => delivery.value?.status,
  (value) => {
    if (value === 'pending') resume()
    else pause()
  },
  { immediate: true }
)

/** Parsed response body when the receiver answered with JSON. */
const responseJson = computed(() => parseJsonBody(delivery.value?.responseBody))

/**
 * The response code as a label (DESIGN.md §5 badges): neutral outline for 2xx, subtle warning
 * for other client answers, subtle error for server errors and 410 (which disables the endpoint).
 */
const httpBadge = computed<BadgeProps>(() => {
  const code = delivery.value?.responseStatus ?? 0

  if (code >= 200 && code < 300) return { color: 'neutral', variant: 'outline' }

  return { color: code >= 500 || code === 410 ? 'error' : 'warning', variant: 'subtle' }
})
</script>

<template>
  <USlideover
    :title="delivery?.eventType ?? 'Delivery'"
    :description="delivery?.endpoint.url"
    :ui="{ content: 'sm:max-w-2xl', description: 'font-mono text-xs truncate', body: 'space-y-6' }"
    @update:open="(v: boolean) => !v && emit('close', changed)"
  >
    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Couldn't load this delivery"
        :description="apiErrorMessage(error)"
        compact
      >
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          variant="outline"
          @click="() => refresh()"
        />
      </EmptyState>

      <div
        v-else-if="!delivery && status === 'pending'"
        class="space-y-6"
        aria-busy="true"
        aria-label="Loading delivery"
      >
        <USkeleton class="h-5 w-40" />
        <div class="space-y-2">
          <USkeleton v-for="i in 5" :key="i" class="h-4 w-full max-w-sm" />
        </div>
        <div class="space-y-2">
          <USkeleton class="h-4 w-16" />
          <USkeleton class="h-48 w-full" />
        </div>
      </div>

      <template v-else-if="delivery">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :status="delivery.status" />
          <UBadge
            v-if="delivery.responseStatus"
            v-bind="httpBadge"
            :label="`HTTP ${delivery.responseStatus}`"
            class="font-mono tabular-nums"
          />
          <span
            v-if="delivery.status === 'pending'"
            class="inline-flex items-center gap-1.5 text-xs text-muted"
            role="status"
          >
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            Waiting for the next attempt
          </span>
        </div>

        <dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          <dt class="text-muted">webhook-id</dt>
          <dd class="flex min-w-0">
            <CopyText :value="delivery.id" />
          </dd>
          <dt class="text-muted">Attempts</dt>
          <dd class="tabular-nums text-highlighted">
            {{ number(delivery.attempts) }}
          </dd>
          <dt class="text-muted">Duration</dt>
          <dd class="tabular-nums text-highlighted">
            {{ delivery.durationMs !== null ? `${number(delivery.durationMs)} ms` : '—' }}
          </dd>
          <dt class="text-muted">Created</dt>
          <dd class="text-highlighted">
            <TimeAgo :date="delivery.createdAt" />
          </dd>
          <dt class="text-muted">Last attempt</dt>
          <dd class="text-highlighted">
            <TimeAgo :date="delivery.lastAttemptAt" fallback="Not attempted yet" />
          </dd>
        </dl>

        <UAlert
          v-if="!delivery.endpoint.enabled"
          color="warning"
          icon="i-lucide-circle-pause"
          title="This endpoint is disabled"
          description="Redeliveries fail immediately until you enable it again."
        />

        <section class="space-y-2" aria-labelledby="delivery-payload">
          <h3 id="delivery-payload" class="text-[13px] font-medium text-highlighted">Payload</h3>
          <JsonBlock :value="delivery.payload" label="Payload" />
        </section>

        <section class="space-y-2" aria-labelledby="delivery-response">
          <h3 id="delivery-response" class="text-[13px] font-medium text-highlighted">Response</h3>
          <JsonBlock
            v-if="responseJson !== undefined"
            :value="responseJson"
            label="Response body"
          />
          <CodeBlock
            v-else-if="delivery.responseBody"
            :code="delivery.responseBody"
            label="Response body"
          />
          <p v-else class="text-[13px] text-muted">No response body.</p>
        </section>
      </template>
    </template>

    <template #footer>
      <UButton label="Close" variant="ghost" @click="emit('close', changed)" />
      <UButton
        v-if="canRedeliver"
        label="Redeliver"
        icon="i-lucide-rotate-cw"
        :loading="redelivering"
        :disabled="!delivery || delivery.status === 'pending'"
        @click="onRedeliver"
      />
    </template>
  </USlideover>
</template>
