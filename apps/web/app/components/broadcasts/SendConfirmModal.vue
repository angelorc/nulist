<script setup lang="ts">
import { format } from 'date-fns'

/** Final confirmation before a broadcast goes out (now or at a scheduled time). */
const props = defineProps<{
  name: string
  subject: string
  sender: string
  recipients: number
  /** ISO time, null to send now. */
  scheduledAt: string | null
  durationSeconds: number
  ratePerSecond: number
  warnings: string[]
}>()

const emit = defineEmits<{ close: [confirmed: boolean] }>()

const { number } = useFormat()
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const when = computed(() =>
  props.scheduledAt ? format(new Date(props.scheduledAt), 'EEE d MMM yyyy, HH:mm') : null
)

const title = computed(() => {
  const people = `${number(props.recipients)} ${props.recipients === 1 ? 'contact' : 'contacts'}`

  return when.value ? `Schedule for ${people}?` : `Send to ${people}?`
})

const duration = computed(() => {
  const s = props.durationSeconds

  if (s < 60) return 'under a minute'

  if (s < 3600) return `about ${Math.ceil(s / 60)} min`
  const hours = Math.floor(s / 3600)
  const minutes = Math.round((s % 3600) / 60)

  return `about ${hours} h${minutes ? ` ${minutes} min` : ''}`
})

const rows = computed(() => [
  { label: 'Broadcast', value: props.name },
  { label: 'Subject', value: props.subject },
  { label: 'From', value: props.sender },
  { label: 'When', value: when.value ? `${when.value} (${timezone})` : 'Now' },
  { label: 'Duration', value: `${duration.value} at ${number(props.ratePerSecond)} emails/s` }
])
</script>

<template>
  <UModal
    :title="title"
    :description="
      when
        ? 'The audience is resolved again when sending starts.'
        : 'Sending starts right away. You can pause or cancel it from the report.'
    "
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template #body>
      <div class="space-y-3">
        <dl class="divide-y divide-default text-[13px] rounded-md ring ring-default">
          <div v-for="row in rows" :key="row.label" class="flex gap-3 px-3 py-2">
            <dt class="w-20 shrink-0 text-muted">
              {{ row.label }}
            </dt>
            <dd class="min-w-0 text-highlighted break-words">
              {{ row.value }}
            </dd>
          </div>
        </dl>
        <UAlert
          v-if="warnings.length"
          color="warning"
          icon="i-lucide-triangle-alert"
          :title="
            warnings.length === 1
              ? 'Sending with 1 warning'
              : `Sending with ${warnings.length} warnings`
          "
        >
          <template #description>
            <ul class="list-disc ps-4 space-y-0.5">
              <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
            </ul>
          </template>
        </UAlert>
      </div>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', false)" />
      <UButton
        :label="when ? 'Schedule broadcast' : `Send to ${number(recipients)}`"
        :icon="when ? 'i-lucide-calendar-clock' : 'i-lucide-send'"
        autofocus
        @click="emit('close', true)"
      />
    </template>
  </UModal>
</template>
