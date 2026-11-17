<script setup lang="ts">
import type { DropdownMenuItem, TabsItem } from '@nuxt/ui'
import { segmentRulesSchema } from '#shared/schemas/segments'
import type { SegmentInput } from '#shared/schemas/segments'
import type { SegmentRules } from '#shared/types/domain'
import type { SegmentMembershipStats } from '#shared/types/segments'
import type { SegmentFormState } from '~/components/segments/SegmentForm.vue'

definePageMeta({ permission: { segment: ['read'] } })

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)

const { can } = useOrganization()
const canUpdate = computed(() => can({ segment: ['update'] }))
const canDelete = computed(() => can({ segment: ['delete'] }))
const canViewContacts = computed(() => can({ contact: ['read'] }))
const canReadAudit = computed(() => can({ audit: ['read'] }))

interface SegmentDetail {
  id: string
  name: string
  description: string | null
  rules: SegmentRules
  contactCount: number | null
  summary: string
  updatedAt: string
}

type SavedSegment = Pick<SegmentDetail, 'name' | 'description' | 'rules'>

// Typed explicitly: `/api/segments/${id}` also matches the static `/api/segments/count` route.
const url: string = `/api/segments/${id}`
const { data: segment, error, refresh } = await useFetch<SegmentDetail>(url)

// Segments of another organization are reported as missing (404) by the API.
if (error.value?.statusCode === 403) {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: "You don't have permission to view this segment.",
    fatal: true
  })
}

if (error.value || !segment.value)
  throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

useSeoMeta({ title: () => segment.value?.name ?? 'Segment' })

const statsUrl: string = `/api/segments/${id}/stats`

const { data: stats, refresh: refreshStats } = useFetch<SegmentMembershipStats>(statsUrl, {
  lazy: true
})

const SYNC_POLL_MS = 3000
const MAX_SYNC_POLLS = 20

interface SyncWait {
  previous: SegmentMembershipStats['syncedAt'] | undefined
  polls: number
}

const syncWait = ref<SyncWait | null>(null)
const historyVersion = ref(0)

const syncing = computed(
  () => !!syncWait.value && stats.value?.syncedAt === syncWait.value.previous
)

const { pause: stopStatsPoll, resume: startStatsPoll } = useIntervalFn(
  () => {
    if (!syncWait.value || syncWait.value.polls >= MAX_SYNC_POLLS) {
      syncWait.value = null

      return
    }

    syncWait.value.polls++
    void refreshStats()
  },
  SYNC_POLL_MS,
  { immediate: false }
)

watch(syncing, (value, previous) => {
  if (value) startStatsPoll()
  else stopStatsPoll()

  if (previous && !value) historyVersion.value++
})

const { number } = useFormat()
const confirm = useConfirm()
const form = useTemplateRef('form')

function toState(source: SavedSegment): SegmentFormState {
  return JSON.parse(
    JSON.stringify({
      name: source.name,
      description: source.description ?? '',
      rules: source.rules
    })
  )
}

function snapshot(source: SegmentFormState): string {
  const rules = segmentRulesSchema.safeParse(source.rules)

  return JSON.stringify({ ...source, rules: rules.success ? rules.data : source.rules })
}

const state = ref<SegmentFormState>(toState(segment.value))
const baseline = ref(JSON.stringify(state.value))
const savedSnapshot = computed(() => snapshot(JSON.parse(baseline.value)))
const dirty = computed(() => snapshot(state.value) !== savedSnapshot.value)
const contactsVersion = ref(0)
let leaving = false

// Tabs ---------------------------------------------------------------------
type Tab = 'rules' | 'contacts' | 'history'

const tab = computed<Tab>({
  get: () => {
    if (!canViewContacts.value) return 'rules'

    if (route.query.tab === 'history') return 'history'

    return route.query.tab === 'contacts' ? 'contacts' : 'rules'
  },
  set: (value) => {
    router.replace({
      query: {
        ...route.query,
        tab: value === 'rules' ? undefined : value,
        page: undefined,
        q: undefined
      }
    })
  }
})

const tabs = computed<TabsItem[]>(() => {
  const items: TabsItem[] = [{ label: 'Conditions', value: 'rules', icon: 'i-lucide-list-filter' }]

  if (!canViewContacts.value) return items

  const contactCount = segment.value?.contactCount

  items.push({
    label: 'Contacts',
    value: 'contacts',
    icon: 'i-lucide-users',
    badge:
      contactCount === null || contactCount === undefined
        ? undefined
        : {
            label: number(contactCount),
            color: 'neutral',
            variant: 'subtle',
            class: 'tabular-nums'
          }
  })
  items.push({ label: 'History', value: 'history', icon: 'i-lucide-history' })

  return items
})

// Actions ------------------------------------------------------------------
const { run: update, pending } = useApiAction(
  (data: SegmentInput) => $fetch<SavedSegment>(url, { method: 'PATCH', body: data }),
  { success: 'Segment saved' }
)

async function save(data: SegmentInput) {
  const previousRules = JSON.stringify(segment.value?.rules)
  const row = await update(data)

  if (!row) return
  state.value = toState(row)
  baseline.value = JSON.stringify(state.value)
  contactsVersion.value++
  historyVersion.value++

  if (JSON.stringify(row.rules) !== previousRules)
    syncWait.value = { previous: stats.value?.syncedAt, polls: 0 }

  await refresh()
}

const { run: remove } = useApiAction(() => $fetch<unknown>(url, { method: 'DELETE' }), {
  success: 'Segment deleted',
  error: "Couldn't delete the segment"
})

async function onDelete() {
  const ok = await confirm({
    title: `Delete "${segment.value?.name}"?`,
    description:
      "Contacts are not affected; only this saved filter is removed. This can't be undone.",
    confirmLabel: 'Delete segment',
    danger: true
  })

  if (!ok || (await remove()) === undefined) return
  leaving = true
  await navigateTo('/segments')
}

/** The navbar `…` menu: Delete sits there, never as a red navbar button (DESIGN.md §5). */
const menuItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []

  if (canReadAudit.value)
    groups.push([
      {
        label: 'View history',
        icon: 'i-lucide-history',
        to: LogLinks.audit({ entityType: 'segment', entityId: id })
      }
    ])

  if (canDelete.value)
    groups.push([
      { label: 'Delete segment', icon: 'i-lucide-trash', color: 'error', onSelect: onDelete }
    ])

  return groups
})

function discard() {
  state.value = JSON.parse(baseline.value)
}

onBeforeRouteLeave(async (to) => {
  if (leaving || !canUpdate.value || !dirty.value || to.path === route.path) return true

  return confirm({
    title: 'Discard unsaved changes?',
    description: `Your changes to "${segment.value?.name}" will be lost.`,
    confirmLabel: 'Discard',
    danger: true
  })
})

useEventListener(
  import.meta.client ? window : undefined,
  'beforeunload',
  (event: BeforeUnloadEvent) => {
    if (canUpdate.value && dirty.value && !leaving) event.preventDefault()
  }
)

defineShortcuts({
  meta_s: {
    usingInput: true,
    handler: () => {
      if (canUpdate.value && dirty.value) form.value?.submit()
    }
  }
})
</script>

<template>
  <UDashboardPanel id="segment-detail">
    <template #header>
      <UDashboardNavbar :title="segment?.name">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/segments"
            aria-label="Back to segments"
          />
        </template>
        <template #trailing>
          <UBadge
            v-if="!canUpdate"
            variant="outline"
            icon="i-lucide-eye"
            label="Read-only"
            class="hidden sm:inline-flex"
          />
          <UBadge
            v-else-if="dirty"
            color="warning"
            label="Unsaved changes"
            class="hidden sm:inline-flex"
          />
        </template>
        <template #right>
          <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" variant="ghost" aria-label="More actions" />
          </UDropdownMenu>
          <UButton v-if="canUpdate && dirty" label="Discard" variant="ghost" @click="discard" />
          <UTooltip v-if="canUpdate" text="Save changes" :kbds="['meta', 's']">
            <UButton
              type="submit"
              form="segment-form"
              label="Save changes"
              :disabled="!dirty"
              :loading="pending"
              @click="tab = 'rules'"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <UTabs v-model="tab" :items="tabs" :content="false" size="sm" />
        </template>
        <template #right>
          <SegmentsSegmentMembershipSummary :stats="stats" :syncing="syncing" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="w-full max-w-6xl">
        <p v-if="segment?.description && tab === 'contacts'" class="mb-4 text-sm text-muted">
          {{ segment.description }}
        </p>

        <SegmentsSegmentForm
          v-show="tab === 'rules'"
          id="segment-form"
          ref="form"
          v-model:state="state"
          :segment-id="id"
          :readonly="!canUpdate"
          @submit="save"
        />

        <template v-if="tab === 'contacts'">
          <UAlert
            v-if="canUpdate && dirty"
            icon="i-lucide-info"
            title="Showing contacts for the saved conditions"
            description="Save your changes to update this list."
            class="mb-4"
          />
          <p v-else class="mb-4 text-sm text-muted">
            {{ segment?.summary }}
          </p>
          <SegmentsSegmentContactsTable :key="contactsVersion" :segment-id="id" />
        </template>

        <SegmentsSegmentHistoryTable
          v-else-if="tab === 'history'"
          :key="historyVersion"
          :segment-id="id"
          :synced="stats ? !!stats.syncedAt : null"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
