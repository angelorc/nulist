<script setup lang="ts">
import type { BroadcastProgress } from '#shared/types/broadcasts'
import type { BroadcastStatus } from '#shared/types/domain'

/** Live sending progress with throughput-based time estimate. */
const props = defineProps<{ status: BroadcastStatus; progress: BroadcastProgress }>()

const { number, percent } = useFormat()

const processed = computed(
  () =>
    props.progress.sent +
    props.progress.failed +
    props.progress.suppressed +
    props.progress.cancelled
)

const ratio = computed(() =>
  props.progress.recipients ? processed.value / props.progress.recipients : 0
)

/** Throughput observed while this page is open (emails per second). */
const samples = ref<{ at: number; processed: number }[]>([])

watch(
  processed,
  (value) => {
    samples.value = [...samples.value, { at: Date.now(), processed: value }].slice(-15)
  },
  { immediate: true }
)

const eta = computed(() => {
  const first = samples.value[0]
  const last = samples.value.at(-1)

  if (props.status !== 'sending' || !first || !last || first === last) return null
  const rate = (last.processed - first.processed) / Math.max(1, (last.at - first.at) / 1000)

  if (rate <= 0) return null
  const seconds = Math.ceil(props.progress.pending / rate)

  if (seconds < 60) return 'less than a minute left'

  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} min left`

  return `about ${Math.round(seconds / 360) / 10} h left`
})

const heading = computed(() => {
  if (props.status === 'paused') return 'Paused'

  if (props.status === 'scheduled' || !props.progress.recipients) return 'Preparing recipients…'

  return 'Sending…'
})

const stats = computed(() => [
  { label: 'Sent', value: props.progress.sent },
  { label: 'Pending', value: props.progress.pending },
  { label: 'Suppressed', value: props.progress.suppressed },
  { label: 'Failed', value: props.progress.failed }
])
</script>

<template>
  <section class="rounded-lg ring ring-default p-4 space-y-3" aria-labelledby="progress-title">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id="progress-title"
        class="flex items-center gap-2 text-sm font-semibold text-highlighted"
        aria-live="polite"
      >
        <UIcon
          v-if="status === 'paused'"
          name="i-lucide-circle-pause"
          class="size-4 text-muted"
          aria-hidden="true"
        />
        <UIcon
          v-else
          name="i-lucide-loader-circle"
          class="size-4 text-info animate-spin"
          aria-hidden="true"
        />
        {{ heading }}
      </h2>
      <p class="text-[13px] text-muted tabular-nums">
        <span class="text-highlighted font-medium">{{ number(processed) }}</span> of
        {{ number(progress.recipients) }} · {{ percent(ratio) }}
        <template v-if="eta"> · {{ eta }} </template>
      </p>
    </div>
    <UProgress
      :model-value="processed"
      :max="Math.max(1, progress.recipients)"
      size="sm"
      :color="status === 'paused' ? 'neutral' : 'primary'"
      :animation="progress.recipients ? undefined : 'carousel'"
      :aria-label="`${number(processed)} of ${number(progress.recipients)} processed`"
    />
    <dl class="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <div v-for="stat in stats" :key="stat.label" class="flex items-center gap-1.5">
        <dt class="text-muted">
          {{ stat.label }}
        </dt>
        <dd class="tabular-nums text-highlighted">
          {{ number(stat.value) }}
        </dd>
      </div>
    </dl>
    <p v-if="status === 'paused'" class="text-xs text-muted">
      Nothing is sent while paused. Resume to continue where it stopped.
    </p>
  </section>
</template>
