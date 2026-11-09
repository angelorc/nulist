<script setup lang="ts">
import { inboundEventLabel } from '#shared/schemas/webhooks'
import type { InboundEventDetail } from '#shared/schemas/webhooks'

const props = defineProps<{ eventId: string }>()
const emit = defineEmits<{ close: [] }>()

const url: string = `/api/inbound-events/${props.eventId}`

const {
  data: inbound,
  status,
  error,
  refresh
} = useFetch<InboundEventDetail>(url, { key: `inbound-event-${props.eventId}` })

const title = computed(() => (inbound.value ? inboundEventLabel(inbound.value) : 'Inbound event'))
</script>

<template>
  <USlideover
    :title="title"
    :description="inbound?.recipient ?? undefined"
    :ui="{ content: 'sm:max-w-2xl', body: 'space-y-6' }"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Couldn't load this event"
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
        v-else-if="!inbound && status === 'pending'"
        class="space-y-6"
        aria-busy="true"
        aria-label="Loading event"
      >
        <USkeleton class="h-5 w-24" />
        <div class="space-y-2">
          <USkeleton v-for="i in 4" :key="i" class="h-4 w-full max-w-sm" />
        </div>
        <div class="space-y-2">
          <USkeleton class="h-4 w-16" />
          <USkeleton class="h-64 w-full" />
        </div>
      </div>

      <template v-else-if="inbound">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :status="inbound.status" />
          <UBadge
            v-if="inbound.type === 'Simulation'"
            label="Simulated"
            icon="i-lucide-flask-conical"
            variant="outline"
          />
        </div>

        <UAlert
          v-if="inbound.error"
          :color="inbound.status === 'failed' ? 'error' : 'neutral'"
          :icon="inbound.status === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-info'"
          :title="inbound.status === 'failed' ? 'Processing failed' : 'Ignored'"
          :description="inbound.error"
        />

        <dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          <dt class="text-muted">Received</dt>
          <dd class="text-highlighted">
            <TimeAgo :date="inbound.createdAt" />
          </dd>
          <dt class="text-muted">SNS message</dt>
          <dd class="flex min-w-0">
            <CopyText :value="inbound.snsMessageId" />
          </dd>
          <dt class="text-muted">SNS type</dt>
          <dd class="text-highlighted">
            {{ inbound.type }}
          </dd>
          <template v-if="inbound.topicArn">
            <dt class="text-muted">Topic</dt>
            <dd class="flex min-w-0">
              <CopyText :value="inbound.topicArn" />
            </dd>
          </template>
          <template v-if="inbound.messageId">
            <dt class="text-muted">Message</dt>
            <dd class="flex min-w-0">
              <CopyText :value="inbound.messageId" />
            </dd>
          </template>
        </dl>

        <section class="space-y-2" aria-labelledby="inbound-event-payload">
          <h3 id="inbound-event-payload" class="text-[13px] font-medium text-highlighted">
            Payload
          </h3>
          <JsonBlock :value="inbound.payload" label="Payload" max-height="28rem" />
        </section>
      </template>
    </template>
  </USlideover>
</template>
