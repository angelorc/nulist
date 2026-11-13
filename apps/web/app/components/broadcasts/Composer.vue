<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import {
  broadcastNameFallback,
  broadcastUpdateSchema,
  campaignSlug
} from '#shared/schemas/broadcasts'
import type { BroadcastUpdateInput } from '#shared/schemas/broadcasts'
import type {
  AudienceListOption,
  AudienceSegmentOption,
  BroadcastDetail,
  BroadcastDto,
  BroadcastPreflight,
  BroadcastPreview
} from '#shared/types/broadcasts'
import type { AudienceDefinition } from '#shared/types/domain'
import { BroadcastsSendConfirmModal } from '#components'

/**
 * Single-page broadcast composer (DESIGN.md §7): email-client style fields on the
 * left with a live preview, pre-flight checklist and send actions on the right.
 * Drafts autosave (debounced PATCH); scheduled broadcasts are read-only, and so
 * is every draft for members whose role can't edit broadcasts.
 */
const props = defineProps<{ broadcast: BroadcastDetail }>()
const emit = defineEmits<{ changed: [] }>()

const id = props.broadcast.id
const { can } = useOrganization()

/** Locked by its status: scheduled (or starting) until unscheduled. */
const scheduled = computed(() => props.broadcast.status !== 'draft')
const canEdit = computed(() => can({ broadcast: ['update'] }))
const canSend = computed(() => can({ broadcast: ['send'] }))
const readOnly = computed(() => scheduled.value || !canEdit.value)

interface DraftState {
  name: string
  subject: string
  preheader: string
  fromName: string
  fromEmail: string
  replyTo: string
  templateId: string | null
  topicId: string | null
  audience: AudienceDefinition
  utm: { enabled: boolean; source: string; medium: string; campaign: string }
}

function toDraft(b: BroadcastDetail): DraftState {
  return {
    name: b.name,
    subject: b.subject,
    preheader: b.preheader ?? '',
    fromName: b.fromName ?? '',
    fromEmail: b.fromEmail ?? '',
    replyTo: b.replyTo ?? '',
    templateId: b.templateId,
    topicId: b.topicId,
    audience: {
      listIds: [...b.audience.listIds],
      segmentIds: [...b.audience.segmentIds],
      excludeListIds: [...b.audience.excludeListIds]
    },
    utm: {
      enabled: b.utm.enabled,
      source: b.utm.source ?? '',
      medium: b.utm.medium ?? '',
      campaign: b.utm.campaign ?? ''
    }
  }
}

const draft = reactive<DraftState>(toDraft(props.broadcast))

function payload(): BroadcastUpdateInput {
  return {
    name: broadcastNameFallback(draft.name, draft.subject),
    subject: draft.subject.trim(),
    preheader: draft.preheader.trim(),
    fromName: draft.fromName.trim(),
    fromEmail: draft.fromEmail.trim(),
    replyTo: draft.replyTo.trim(),
    templateId: draft.templateId,
    topicId: draft.topicId,
    audience: draft.audience,
    utm: {
      enabled: draft.utm.enabled,
      source: draft.utm.source.trim() || undefined,
      medium: draft.utm.medium.trim() || undefined,
      campaign: draft.utm.campaign.trim() || undefined
    }
  }
}

useSeoMeta({ title: () => draft.name || 'Broadcast' })

// Reference data ----------------------------------------------------------------
interface TemplateOption {
  id: string
  name: string
  kind: 'marketing' | 'transactional'
  subject: string
  preheader: string | null
}

interface TopicOption {
  id: string
  name: string
  defaultSubscribed: boolean
}

const { data: lists, status: listsStatus } = useFetch<AudienceListOption[]>('/api/lists', {
  lazy: true,
  server: false,
  default: () => []
})

const { data: segments, status: segmentsStatus } = useFetch<AudienceSegmentOption[]>(
  '/api/segments',
  { lazy: true, server: false, default: () => [] }
)

const { data: topics } = useFetch<TopicOption[]>('/api/topics', {
  lazy: true,
  server: false,
  default: () => []
})

const {
  data: templates,
  status: templatesStatus,
  refresh: refreshTemplates
} = useFetch<TemplateOption[]>('/api/templates', {
  query: { kind: 'marketing' },
  lazy: true,
  server: false,
  default: () => []
})

/** Client-only fetches are `idle` during SSR: count that as loading so hydration matches. */
function busy(status: string) {
  return status === 'idle' || status === 'pending'
}

const audienceLoading = computed(() => busy(listsStatus.value) || busy(segmentsStatus.value))

const templateItems = computed(() => {
  const items = templates.value.map((t) => ({
    label: t.name,
    value: t.id,
    icon: 'i-lucide-layout-template'
  }))

  const current = props.broadcast.template

  if (current && draft.templateId === current.id && !items.some((i) => i.value === current.id)) {
    items.unshift({
      label: `${current.name} (${current.kind})`,
      value: current.id,
      icon: 'i-lucide-zap'
    })
  }

  return items
})

const templateValue = computed({
  get: () => draft.templateId ?? undefined,
  set: (value: string | undefined) => {
    draft.templateId = value ?? null
  }
})

const topicItems = computed(() => [
  { label: 'No topic', value: 'none', description: 'Every recipient in the audience' },
  ...topics.value.map((t) => ({
    label: t.name,
    value: t.id,
    description: t.defaultSubscribed ? 'Skips contacts who opted out' : 'Only contacts who opted in'
  }))
])

const topicValue = computed({
  get: () => draft.topicId ?? 'none',
  set: (value: string) => {
    draft.topicId = value === 'none' ? null : value
  }
})

/** Picking a template fills an empty subject and preview text from it. */
watch(
  () => draft.templateId,
  (templateId) => {
    const template = templates.value.find((t) => t.id === templateId)

    if (!template) return

    if (!draft.subject.trim() && template.subject) draft.subject = template.subject

    if (!draft.preheader.trim() && template.preheader) draft.preheader = template.preheader
  }
)

// Validation ------------------------------------------------------------------
/** First schema error per field, keyed by its dotted path (`fromEmail`, `utm.source`). */
const fieldErrors = computed<Partial<Record<string, string>>>(() => {
  const parsed = broadcastUpdateSchema.safeParse(payload())

  if (parsed.success) return {}
  const errors: Partial<Record<string, string>> = {}

  for (const issue of parsed.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : 'form'
    errors[key] ??= issue.message
  }

  return errors
})

// Autosave --------------------------------------------------------------------
const notify = useNotify()
const signature = computed(() => JSON.stringify(payload()))
const savedSignature = ref(signature.value)
const savedAt = ref(props.broadcast.updatedAt)
const saving = ref(false)
const saveError = ref<string | null>(null)
const dirty = computed(() => signature.value !== savedSignature.value)

let timer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<boolean> | null = null

async function save(): Promise<boolean> {
  if (readOnly.value) return true

  if (inflight) await inflight

  // Back to the saved state (e.g. an invalid edit was undone): nothing to save, nothing to fix.
  if (!dirty.value) {
    saveError.value = null

    return true
  }

  if (Object.keys(fieldErrors.value).length) {
    saveError.value = 'Fix the highlighted fields to save'

    return false
  }

  const body = payload()
  const sig = JSON.stringify(body)
  saving.value = true
  inflight = $fetch<BroadcastDto>(`/api/broadcasts/${id}`, { method: 'PATCH', body })
    .then((row) => {
      savedSignature.value = sig
      savedAt.value = row.updatedAt
      saveError.value = null

      return true
    })
    .catch((cause: unknown) => {
      saveError.value = apiErrorMessage(cause)

      return false
    })
    .finally(() => {
      saving.value = false
      inflight = null
    })
  const ok = await inflight

  if (ok) {
    void refreshPreflight()
    void refreshPreview()
  }

  return ok
}

function scheduleSave() {
  clearTimeout(timer)
  timer = setTimeout(() => void save(), 800)
}

async function flush(): Promise<boolean> {
  clearTimeout(timer)

  if (readOnly.value) return true
  const ok = await save()

  if (!ok && saveError.value) {
    notify.error('Changes not saved', undefined, { description: saveError.value })
  }

  return ok
}

watch(signature, () => {
  if (!readOnly.value) scheduleSave()
})

defineShortcuts({
  meta_s: { usingInput: true, handler: () => void flush() }
})

onBeforeUnmount(() => {
  if (!readOnly.value && dirty.value) void save()
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (readOnly.value || (!dirty.value && !saving.value)) return
  event.preventDefault()
  event.returnValue = ''
})

// Pre-flight and preview --------------------------------------------------------
const {
  data: preflight,
  status: preflightStatus,
  error: preflightError,
  refresh: refreshPreflight
} = useFetch<BroadcastPreflight>(`/api/broadcasts/${id}/checklist`, { lazy: true, server: false })

const {
  data: preview,
  status: previewStatus,
  error: previewError,
  refresh: refreshPreview
} = useFetch<BroadcastPreview>(`/api/broadcasts/${id}/preview`, { lazy: true, server: false })

// Templates are edited in another tab: pick up changes when coming back.
const focused = useWindowFocus()

watch(focused, (value) => {
  if (!value) return
  void refreshPreview()
  void refreshPreflight()
  void refreshTemplates()
})

// Subject variables -----------------------------------------------------------
const subjectInput = useTemplateRef<{ inputRef: HTMLInputElement | null }>('subjectInput')

function insertVariable(snippet: string) {
  const el = subjectInput.value?.inputRef
  const start = el?.selectionStart ?? draft.subject.length
  const end = el?.selectionEnd ?? draft.subject.length
  draft.subject = draft.subject.slice(0, start) + snippet + draft.subject.slice(end)
  nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + snippet.length, start + snippet.length)
  })
}

// Sending -----------------------------------------------------------------------
const overlay = useOverlay()
const confirmModal = overlay.create(BroadcastsSendConfirmModal)
const confirm = useConfirm()

const { run: schedule, pending: scheduling } = useApiAction(
  (scheduledAt: string | null) =>
    $fetch<BroadcastDto>(`/api/broadcasts/${id}/schedule`, {
      method: 'POST',
      body: { scheduledAt }
    }),
  {
    success: (row) => (row.scheduledAt ? 'Broadcast scheduled' : 'Sending started'),
    error: 'Broadcast not sent'
  }
)

const { run: unschedule, pending: unscheduling } = useApiAction(
  () => $fetch<BroadcastDto>(`/api/broadcasts/${id}/unschedule`, { method: 'POST' }),
  { success: 'Broadcast unscheduled. It is a draft again.' }
)

async function onSend(scheduledAt: string | null) {
  if (!(await flush())) return
  await refreshPreflight()
  const checks = preflight.value

  if (!checks?.ready) {
    notify.warning('Resolve the blockers first', {
      description: 'The pre-flight checklist lists what is missing.'
    })

    return
  }

  const sender = draft.fromName ? `${draft.fromName} <${draft.fromEmail}>` : draft.fromEmail

  const ok = await confirmModal.open({
    name: draft.name,
    subject: draft.subject,
    sender,
    recipients: checks.recipients,
    scheduledAt,
    durationSeconds: checks.durationSeconds,
    ratePerSecond: checks.ratePerSecond,
    warnings: checks.items
      .filter((i) => i.status === 'warning')
      .map((i) => `${i.label}: ${i.detail}`)
  }).result

  if (!ok) return

  if (await schedule(scheduledAt)) emit('changed')
}

async function onUnschedule() {
  if (await unschedule()) emit('changed')
}

// Header actions ------------------------------------------------------------------
const { run: duplicate } = useApiAction(
  () => $fetch<BroadcastDto>(`/api/broadcasts/${id}/duplicate`, { method: 'POST' }),
  { success: 'Broadcast duplicated' }
)

const { run: remove } = useApiAction(
  () => $fetch<unknown>(`/api/broadcasts/${id}`, { method: 'DELETE' }),
  { success: 'Draft deleted' }
)

async function onDuplicate() {
  if (!readOnly.value) await flush()
  const copy = await duplicate()

  if (copy) await navigateTo(`/broadcasts/${copy.id}`)
}

async function onDelete() {
  const ok = await confirm({
    title: `Delete "${draft.name}"?`,
    description: "This draft is deleted for good. This can't be undone.",
    confirmLabel: 'Delete draft',
    danger: true
  })

  if (!ok) return
  clearTimeout(timer)
  savedSignature.value = signature.value

  if ((await remove()) !== undefined) await navigateTo('/broadcasts')
}

/** Header menu, limited to what the member's role allows (hidden when empty). */
const menuItems = computed(() => {
  const groups: DropdownMenuItem[][] = []

  if (can({ broadcast: ['create'] }))
    groups.push([{ label: 'Duplicate', icon: 'i-lucide-copy', onSelect: onDuplicate }])

  if (!readOnly.value && can({ broadcast: ['delete'] })) {
    groups.push([
      { label: 'Delete draft', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }
    ])
  }

  return groups
})

const canCreateTemplate = computed(() => !readOnly.value && can({ template: ['create'] }))
const canReadTemplate = computed(() => can({ template: ['read'] }))
const canEditTemplate = computed(() => can({ template: ['update'] }))

const { relative } = useFormat()
const now = useRelativeNow()
const savedLabel = computed(() => relative(savedAt.value, now.value))

/** Borderless inputs that read like an email client's header fields. */
const inputUi = {
  base: 'px-2 hover:bg-elevated/60 focus-visible:bg-default disabled:bg-transparent disabled:opacity-100 disabled:cursor-default'
}

const monoInputUi = { base: `${inputUi.base} font-mono text-[13px]` }

/** Enter in the name field commits it (autosave) by leaving the field. */
function blurOnEnter(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement) event.target.blur()
}

const campaignPlaceholder = computed(() => campaignSlug(draft.name || 'broadcast'))
</script>

<template>
  <UDashboardPanel id="broadcast-composer">
    <template #header>
      <UDashboardNavbar
        :ui="{ root: 'gap-3', left: 'flex-1 min-w-0', title: 'flex-1 min-w-24 max-w-md' }"
      >
        <template #leading>
          <UTooltip text="Back to broadcasts">
            <UButton
              icon="i-lucide-arrow-left"
              variant="ghost"
              to="/broadcasts"
              aria-label="Back to broadcasts"
            />
          </UTooltip>
        </template>
        <template #title>
          <UInput
            v-model="draft.name"
            variant="ghost"
            :placeholder="broadcastNameFallback(null, draft.subject)"
            aria-label="Broadcast name"
            maxlength="120"
            :disabled="readOnly"
            class="w-full"
            :ui="{
              base: 'font-semibold text-highlighted text-base px-1.5 hover:bg-elevated/60 focus-visible:bg-default focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accented disabled:opacity-100 disabled:cursor-default'
            }"
            @keydown.enter="blurOnEnter"
          />
        </template>
        <template #trailing>
          <StatusBadge :status="broadcast.status" class="shrink-0" />
          <span
            v-if="!readOnly"
            class="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap ms-1"
            role="status"
          >
            <template v-if="saving">
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
              <span class="max-md:sr-only">Saving…</span>
            </template>
            <template v-else-if="saveError">
              <UIcon name="i-lucide-circle-alert" class="size-3.5 text-error" />
              <span class="max-md:sr-only text-error">{{ saveError }}</span>
            </template>
            <template v-else-if="dirty">
              <span class="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              <span class="max-md:sr-only">Editing</span>
            </template>
            <template v-else>
              <UIcon name="i-lucide-check" class="size-3.5" />
              <span class="max-md:sr-only"> Saved <ClientOnly>{{ savedLabel }}</ClientOnly> </span>
            </template>
          </span>
        </template>
        <template #right>
          <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More actions" />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div class="min-w-0 space-y-6">
          <UAlert
            v-if="scheduled"
            color="info"
            icon="i-lucide-calendar-clock"
            :description="
              canSend
                ? 'This broadcast is locked while it is scheduled. Unschedule it to make changes.'
                : 'This broadcast is locked while it is scheduled.'
            "
          >
            <template #title>
              <template v-if="broadcast.scheduledAt">
                Scheduled for
                <NuxtTime
                  :datetime="broadcast.scheduledAt"
                  locale="en-GB"
                  weekday="short"
                  day="numeric"
                  month="short"
                  year="numeric"
                  hour="2-digit"
                  minute="2-digit"
                  hour-cycle="h23"
                />
              </template>
              <template v-else>Sending starts shortly</template>
            </template>
          </UAlert>
          <UAlert
            v-else-if="!canEdit"
            color="info"
            icon="i-lucide-eye"
            title="View only"
            description="Your role can view this draft but not edit it."
          />

          <section
            class="rounded-lg ring ring-default divide-y divide-default"
            aria-label="Message"
          >
            <BroadcastsComposerRow label="From" for="broadcast-from-name">
              <div class="flex flex-col sm:flex-row gap-1 sm:gap-2">
                <UInput
                  id="broadcast-from-name"
                  v-model="draft.fromName"
                  variant="ghost"
                  placeholder="Sender name"
                  aria-label="Sender name"
                  maxlength="120"
                  :disabled="readOnly"
                  class="sm:w-44"
                  :ui="inputUi"
                />
                <UFormField name="fromEmail" :error="fieldErrors.fromEmail" class="flex-1 min-w-0">
                  <UInput
                    id="broadcast-from-email"
                    v-model="draft.fromEmail"
                    variant="ghost"
                    type="email"
                    placeholder="hello@yourdomain.com"
                    aria-label="Sender email"
                    :disabled="readOnly"
                    class="w-full"
                    :ui="monoInputUi"
                  />
                </UFormField>
              </div>
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="Reply-to" for="broadcast-reply-to">
              <UFormField name="replyTo" :error="fieldErrors.replyTo">
                <UInput
                  id="broadcast-reply-to"
                  v-model="draft.replyTo"
                  variant="ghost"
                  type="email"
                  placeholder="Same as sender"
                  :disabled="readOnly"
                  class="w-full"
                  :ui="monoInputUi"
                />
              </UFormField>
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="To">
              <BroadcastsAudiencePicker
                v-model="draft.audience"
                :lists="lists"
                :segments="segments"
                :topic-id="draft.topicId"
                :loading="audienceLoading"
                :disabled="readOnly"
              />
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="Subject" for="broadcast-subject">
              <div class="flex items-center gap-1">
                <UFormField name="subject" :error="fieldErrors.subject" class="flex-1 min-w-0">
                  <UInput
                    id="broadcast-subject"
                    ref="subjectInput"
                    v-model="draft.subject"
                    variant="ghost"
                    placeholder="What is this email about?"
                    maxlength="300"
                    :disabled="readOnly"
                    class="w-full"
                    :ui="{ ...inputUi, base: `${inputUi.base} font-medium text-highlighted` }"
                  />
                </UFormField>
                <BroadcastsVariableMenu v-if="!readOnly" @insert="insertVariable" />
              </div>
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="Preview text" for="broadcast-preheader">
              <UFormField name="preheader" :error="fieldErrors.preheader">
                <UInput
                  id="broadcast-preheader"
                  v-model="draft.preheader"
                  variant="ghost"
                  placeholder="Shown next to the subject in most inboxes"
                  maxlength="300"
                  :disabled="readOnly"
                  class="w-full"
                  :ui="inputUi"
                />
              </UFormField>
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="Template" for="broadcast-template">
              <div class="flex flex-wrap items-center gap-2">
                <USelectMenu
                  id="broadcast-template"
                  v-model="templateValue"
                  :items="templateItems"
                  value-key="value"
                  :loading="busy(templatesStatus)"
                  placeholder="Choose a template"
                  icon="i-lucide-layout-template"
                  variant="ghost"
                  :disabled="readOnly"
                  :search-input="{ placeholder: 'Search templates…', icon: 'i-lucide-search' }"
                  class="min-w-56 max-w-full"
                  :ui="{ base: 'hover:bg-elevated/60', content: 'min-w-64' }"
                >
                  <template #empty>
                    <span class="text-[13px] text-muted">No marketing templates yet.</span>
                  </template>
                </USelectMenu>
                <UButton
                  v-if="draft.templateId && canReadTemplate"
                  :label="canEditTemplate ? 'Edit template' : 'View template'"
                  :icon="canEditTemplate ? 'i-lucide-square-pen' : 'i-lucide-eye'"
                  size="sm"
                  variant="ghost"
                  :to="`/templates/${draft.templateId}`"
                  target="_blank"
                />
                <UButton
                  v-if="canCreateTemplate"
                  label="New template"
                  icon="i-lucide-plus"
                  size="sm"
                  variant="ghost"
                  to="/templates?new=1"
                  target="_blank"
                />
              </div>
            </BroadcastsComposerRow>

            <BroadcastsComposerRow
              label="Topic"
              for="broadcast-topic"
              hint="Contacts manage topics in the preference center."
            >
              <USelect
                id="broadcast-topic"
                v-model="topicValue"
                :items="topicItems"
                variant="ghost"
                :disabled="readOnly"
                class="min-w-56 max-w-full"
                :ui="{ base: 'hover:bg-elevated/60', content: 'min-w-72' }"
              />
            </BroadcastsComposerRow>

            <BroadcastsComposerRow label="Tracking">
              <USwitch
                v-model="draft.utm.enabled"
                :disabled="readOnly"
                label="Add UTM parameters to links"
                :ui="{ root: 'py-1', label: 'text-[13px] font-normal text-default' }"
              />
              <div v-if="draft.utm.enabled" class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <UFormField
                  label="Source"
                  name="utm.source"
                  :error="fieldErrors['utm.source']"
                  :ui="{ label: 'text-xs text-muted font-normal' }"
                >
                  <UInput
                    v-model="draft.utm.source"
                    size="sm"
                    placeholder="newsletter"
                    :disabled="readOnly"
                    maxlength="100"
                    class="w-full"
                    :ui="{ base: 'font-mono text-xs' }"
                  />
                </UFormField>
                <UFormField
                  label="Medium"
                  name="utm.medium"
                  :error="fieldErrors['utm.medium']"
                  :ui="{ label: 'text-xs text-muted font-normal' }"
                >
                  <UInput
                    v-model="draft.utm.medium"
                    size="sm"
                    placeholder="email"
                    :disabled="readOnly"
                    maxlength="100"
                    class="w-full"
                    :ui="{ base: 'font-mono text-xs' }"
                  />
                </UFormField>
                <UFormField
                  label="Campaign"
                  name="utm.campaign"
                  :error="fieldErrors['utm.campaign']"
                  :ui="{ label: 'text-xs text-muted font-normal' }"
                >
                  <UInput
                    v-model="draft.utm.campaign"
                    size="sm"
                    :placeholder="campaignPlaceholder"
                    :disabled="readOnly"
                    maxlength="100"
                    class="w-full"
                    :ui="{ base: 'font-mono text-xs' }"
                  />
                </UFormField>
              </div>
            </BroadcastsComposerRow>
          </section>

          <BroadcastsPreviewFrame
            :preview="preview ?? null"
            :pending="busy(previewStatus)"
            :error="!!previewError"
            :from-name="draft.fromName"
            :from-email="draft.fromEmail"
            :preheader="draft.preheader"
            note="Rendered with sample data. Unsubscribe and preference links are placeholders."
            @refresh="refreshPreview()"
          />
        </div>

        <aside class="space-y-4 lg:sticky lg:top-0" aria-label="Send">
          <BroadcastsChecklist
            :preflight="preflight ?? null"
            :pending="busy(preflightStatus) || dirty"
            :error="!!preflightError"
            @retry="refreshPreflight()"
          />
          <BroadcastsSendPanel
            :broadcast-id="id"
            :preflight="preflight ?? null"
            :scheduled="scheduled"
            :can-send="canSend"
            :scheduled-at="broadcast.scheduledAt"
            :busy="scheduling || unscheduling"
            :before-test="flush"
            @send="onSend"
            @unschedule="onUnschedule"
            @tested="refreshPreflight()"
          />
        </aside>
      </div>
    </template>
  </UDashboardPanel>
</template>
