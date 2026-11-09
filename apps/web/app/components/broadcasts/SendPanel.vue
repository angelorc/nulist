<script setup lang="ts">
import { addDays, format } from 'date-fns'
import { broadcastTestSchema } from '#shared/schemas/broadcasts'
import type { BroadcastPreflight, BroadcastTestResult } from '#shared/types/broadcasts'

/**
 * Right column actions of the composer: test send, schedule and send now.
 * Sending is delegated to the parent, which saves pending edits and confirms first.
 * Members whose role can't send broadcasts (`broadcast:send`) see a note instead.
 */
const props = defineProps<{
  broadcastId: string
  preflight: BroadcastPreflight | null
  /** Scheduled broadcasts are read-only until unscheduled. */
  scheduledAt: string | null
  scheduled: boolean
  /** The member may send tests, schedule, send and unschedule. */
  canSend: boolean
  busy?: boolean
  /** Saves pending edits; returns false when saving failed. */
  beforeTest: () => Promise<boolean>
}>()

const emit = defineEmits<{
  send: [scheduledAt: string | null]
  unschedule: []
  tested: []
}>()

const notify = useNotify()
const { user } = useUserSession()
const { number } = useFormat()

/** The browser's time zone: schedule times are entered and shown in it (client only). */
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// Test send -------------------------------------------------------------------
const remembered = useLocalStorage<string[]>('mlist:broadcast-test-emails', [])

const testEmails = ref<string[]>(
  remembered.value.length ? [...remembered.value] : user.value?.email ? [user.value.email] : []
)

const testError = ref<string | null>(null)

const { run: sendTest, pending: testing } = useApiAction(
  (emails: string[]) =>
    $fetch<BroadcastTestResult>(`/api/broadcasts/${props.broadcastId}/test`, {
      method: 'POST',
      body: { emails }
    }),
  { error: 'Test not sent' }
)

async function onTest() {
  const parsed = broadcastTestSchema.safeParse({ emails: testEmails.value })

  if (!parsed.success) {
    testError.value = parsed.error.issues[0]?.message ?? 'Enter valid email addresses'

    return
  }

  testError.value = null

  if (!(await props.beforeTest())) return
  const result = await sendTest(parsed.data.emails)

  if (!result) return
  remembered.value = parsed.data.emails
  const sent = result.results.filter((r) => r.status === 'sent')
  const failed = result.results.filter((r) => r.status !== 'sent')

  if (sent.length) {
    notify.success(`Test sent to ${sent.map((r) => r.email).join(', ')}`, {
      description: sent.some((r) => r.personalized)
        ? 'Known contacts got their own data; other addresses got sample data.'
        : 'Variables use sample data.'
    })
  }

  for (const failure of failed) {
    notify.error(`Test to ${failure.email} not sent`, undefined, { description: failure.error })
  }

  emit('tested')
}

// Schedule --------------------------------------------------------------------
/**
 * Date and time are local to the browser, so they are filled once mounted (tomorrow 09:00):
 * the server's clock and time zone may differ from the member's.
 */
const date = ref('')
const time = ref('09:00')
const today = ref('')
const mounted = useMounted()

onMounted(() => {
  today.value = format(new Date(), 'yyyy-MM-dd')
  date.value = format(addDays(new Date(), 1), 'yyyy-MM-dd')
})

const scheduledFor = computed<Date | null>(() => {
  if (!date.value || !time.value) return null
  const value = new Date(`${date.value}T${time.value}`)

  return Number.isNaN(value.getTime()) ? null : value
})

const scheduleError = computed(() => {
  if (!mounted.value) return null

  if (!scheduledFor.value) return 'Pick a date and time.'

  if (scheduledFor.value.getTime() < Date.now() + 60_000)
    return 'Pick a time at least a minute from now.'

  return null
})

const ready = computed(() => !!props.preflight?.ready)

const blockerCount = computed(
  () => props.preflight?.items.filter((i) => i.status === 'blocker').length ?? 0
)

function onSchedule() {
  if (scheduleError.value || !scheduledFor.value) return
  emit('send', scheduledFor.value.toISOString())
}
</script>

<template>
  <div class="space-y-4">
    <!-- Scheduled: read-only summary -->
    <section
      v-if="scheduled"
      class="rounded-lg ring ring-default p-4 space-y-3"
      aria-labelledby="scheduled-title"
    >
      <div class="flex items-start gap-2.5">
        <UIcon name="i-lucide-calendar-clock" class="size-4 text-info shrink-0 mt-0.5" />
        <div class="min-w-0">
          <h2 id="scheduled-title" class="text-sm font-semibold text-highlighted">Scheduled</h2>
          <p class="text-[13px] text-muted tabular-nums">
            <template v-if="scheduledAt">
              <NuxtTime
                :datetime="scheduledAt"
                locale="en-GB"
                weekday="short"
                day="numeric"
                month="short"
                year="numeric"
                hour="2-digit"
                minute="2-digit"
                hour-cycle="h23"
              />
              <ClientOnly> · {{ timezone }}</ClientOnly>
            </template>
            <template v-else> Starting now </template>
          </p>
        </div>
      </div>
      <p class="text-xs text-muted">
        The audience is resolved again when sending starts.
        <template v-if="canSend">Unschedule to make changes.</template>
      </p>
      <UButton
        v-if="canSend"
        label="Unschedule"
        icon="i-lucide-calendar-x"
        variant="outline"
        block
        :loading="busy"
        @click="emit('unschedule')"
      />
    </section>

    <section
      v-else-if="!canSend"
      class="rounded-lg ring ring-default p-4"
      aria-labelledby="send-denied-title"
    >
      <div class="flex items-start gap-2.5">
        <UIcon name="i-lucide-lock" class="size-4 text-muted shrink-0 mt-0.5" />
        <div class="min-w-0">
          <h2 id="send-denied-title" class="text-sm font-semibold text-highlighted">Send</h2>
          <p class="text-[13px] text-muted">
            You don't have permission to send broadcasts or tests. Ask an owner or admin.
          </p>
        </div>
      </div>
    </section>

    <template v-else>
      <section class="rounded-lg ring ring-default p-4 space-y-3" aria-labelledby="test-title">
        <div>
          <h2 id="test-title" class="text-sm font-semibold text-highlighted">Send a test</h2>
          <p class="text-xs text-muted mt-0.5">Up to 5 addresses. Pending edits are saved first.</p>
        </div>
        <UFormField name="emails" :error="testError ?? undefined">
          <UInputTags
            v-model="testEmails"
            placeholder="you@example.com"
            :max="5"
            delimiter=","
            add-on-paste
            add-on-blur
            class="w-full"
            aria-label="Test recipients"
            @update:model-value="testError = null"
          />
        </UFormField>
        <UButton
          label="Send test"
          icon="i-lucide-flask-conical"
          variant="outline"
          block
          :loading="testing"
          :disabled="!testEmails.length"
          @click="onTest"
        />
      </section>

      <section class="rounded-lg ring ring-default p-4 space-y-3" aria-labelledby="send-title">
        <div>
          <h2 id="send-title" class="text-sm font-semibold text-highlighted">Send</h2>
          <p class="text-xs text-muted mt-0.5" aria-live="polite">
            <template v-if="!preflight"> Running checks… </template>
            <template v-else-if="!ready">
              Resolve {{ blockerCount }} {{ blockerCount === 1 ? 'blocker' : 'blockers' }} to send.
            </template>
            <template v-else> ≈ {{ number(preflight.recipients) }} recipients </template>
          </p>
        </div>

        <UFormField name="scheduledAt" :error="scheduleError ?? undefined">
          <div class="grid grid-cols-[1fr_6.5rem] gap-2">
            <UInput
              id="broadcast-schedule-date"
              v-model="date"
              type="date"
              :min="today || undefined"
              aria-label="Schedule date"
              class="w-full"
            />
            <UInput
              id="broadcast-schedule-time"
              v-model="time"
              type="time"
              aria-label="Schedule time"
              class="w-full"
            />
          </div>
          <template #help>
            <span class="inline-flex items-center gap-1 text-xs">
              <UIcon name="i-lucide-globe" class="size-3" />
              <ClientOnly>{{ timezone }}</ClientOnly>
            </span>
          </template>
        </UFormField>
        <UButton
          label="Schedule"
          icon="i-lucide-calendar-clock"
          variant="outline"
          block
          :disabled="!ready || !!scheduleError || busy"
          @click="onSchedule"
        />

        <USeparator label="or" :ui="{ label: 'text-xs text-muted' }" />

        <UButton
          label="Send now"
          icon="i-lucide-send"
          block
          :loading="busy"
          :disabled="!ready"
          @click="emit('send', null)"
        />
      </section>
    </template>
  </div>
</template>
