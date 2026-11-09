<script setup lang="ts">
import type { BroadcastDetail } from '#shared/types/broadcasts'

/**
 * One page per broadcast: the composer while it can still be edited or is waiting
 * for its scheduled time, the live report once sending has started.
 */
definePageMeta({ permission: { broadcast: ['read'] } })

const route = useRoute()
const id = String(route.params.id)

const url: string = `/api/broadcasts/${id}`
const { data: broadcast, error, refresh } = await useFetch<BroadcastDetail>(url)

// 422: the id is not a valid UUID, so no such broadcast exists.
if (
  error.value?.statusCode === 404 ||
  error.value?.statusCode === 422 ||
  (!error.value && !broadcast.value)
) {
  throw createError({ statusCode: 404, statusMessage: 'Broadcast not found', fatal: true })
}

if (error.value?.statusCode === 403) {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: "You don't have permission to view this broadcast.",
    fatal: true
  })
}

if (error.value?.statusCode === 409) {
  throw createError({
    statusCode: 409,
    statusMessage: 'No active organization',
    message: 'Choose an organization to view its broadcasts.',
    fatal: true
  })
}

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage ?? "Couldn't load the broadcast",
    fatal: true
  })
}

const status = computed(() => broadcast.value?.status)

const composing = computed(
  () => status.value === 'draft' || (status.value === 'scheduled' && !!broadcast.value?.scheduledAt)
)

/** Remount when switching between composer and report so each starts from fresh state. */
const view = computed(() => (composing.value ? 'composer' : 'report'))

/**
 * Sending, paused or about to start: fast refresh for the progress bar.
 * Scheduled for later: slow refresh to notice when it starts.
 */
const pollEvery = computed(() => {
  const b = broadcast.value

  if (!b) return 0

  if (
    b.status === 'sending' ||
    b.status === 'paused' ||
    (b.status === 'scheduled' && !b.scheduledAt)
  )
    return 2000

  if (b.status === 'scheduled') return 15_000

  return 0
})

const visibility = useDocumentVisibility()
let timer: ReturnType<typeof setTimeout> | undefined

function schedulePoll() {
  clearTimeout(timer)

  if (!pollEvery.value || visibility.value === 'hidden') return
  timer = setTimeout(async () => {
    await refresh()
    schedulePoll()
  }, pollEvery.value)
}

onMounted(schedulePoll)

watch([pollEvery, visibility], schedulePoll)

onBeforeUnmount(() => clearTimeout(timer))

async function onChanged() {
  await refresh()
  schedulePoll()
}
</script>

<template>
  <template v-if="broadcast">
    <BroadcastsComposer
      v-if="view === 'composer'"
      :key="`composer-${broadcast.id}`"
      :broadcast="broadcast"
      @changed="onChanged"
    />
    <BroadcastsReport
      v-else
      :key="`report-${broadcast.id}`"
      :broadcast="broadcast"
      @changed="onChanged"
    />
  </template>
</template>
