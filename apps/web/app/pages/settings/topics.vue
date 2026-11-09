<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { TopicsTopicFormModal } from '#components'

definePageMeta({ permission: { topic: ['read'] } })

useSeoMeta({ title: 'Topics' })

const NO_PERMISSION = "You don't have permission to create topics"

const { organization, can } = useOrganization()

const {
  data: topics,
  status,
  error,
  refresh
} = await useFetch('/api/topics', {
  key: () => `topics:${organization.value?.id ?? 'none'}`,
  default: () => []
})

type TopicRow = NonNullable<typeof topics.value>[number]

const canCreate = computed(() => can({ topic: ['create'] }))
const canUpdate = computed(() => can({ topic: ['update'] }))
const canDelete = computed(() => can({ topic: ['delete'] }))

const { number } = useFormat()
const confirm = useConfirm()
const notify = useNotify()
const formModal = useOverlay().create(TopicsTopicFormModal)

const search = ref('')
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('search')

/** The search appears once the list is long enough to need it. */
const searchable = computed(() => topics.value.length > 5)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  if (!term) return topics.value

  return topics.value.filter(
    (t) => t.name.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term)
  )
})

async function openForm(topic?: TopicRow) {
  if (!can({ topic: [topic ? 'update' : 'create'] })) return

  const saved = await formModal.open({ topic }).result

  if (saved) await refresh()
}

defineShortcuts(
  computed(() => ({
    n: canCreate.value ? () => void openForm() : false,
    '/': searchable.value ? () => searchInput.value?.inputRef?.focus() : false
  }))
)

const { run: remove } = useApiAction(
  (id: string) => $fetch<unknown>(`/api/topics/${id}`, { method: 'DELETE' }),
  { success: 'Topic deleted', error: 'Could not delete the topic' }
)

async function onDelete(topic: TopicRow) {
  const ok = await confirm({
    title: `Delete "${topic.name}"?`,
    description:
      "Contacts' choices for this topic are removed and broadcasts that used it will no longer filter by it. This can't be undone.",
    confirmLabel: 'Delete topic',
    danger: true
  })

  if (ok && (await remove(topic.id)) !== undefined) await refresh()
}

/** Optimistic toggle of the default; reverted if the request fails. */
const toggling = ref(new Set<string>())

async function toggleDefault(topic: TopicRow, value: boolean) {
  if (!canUpdate.value) return

  const previous = topic.defaultSubscribed
  topic.defaultSubscribed = value
  toggling.value.add(topic.id)

  try {
    await $fetch<unknown>(`/api/topics/${topic.id}`, {
      method: 'PATCH',
      body: { defaultSubscribed: value }
    })
    notify.success(
      value ? `"${topic.name}" is now subscribed by default` : `"${topic.name}" is now opt-in only`
    )
  } catch (err) {
    topic.defaultSubscribed = previous
    notify.error("Couldn't update topic", err)
  } finally {
    toggling.value.delete(topic.id)
  }
}

/** Row actions the member may run; groups without an allowed action are dropped. */
function rowActions(topic: TopicRow): DropdownMenuItem[][] {
  const edit: DropdownMenuItem[] = canUpdate.value
    ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openForm(topic) }]
    : []

  const danger: DropdownMenuItem[] = canDelete.value
    ? [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => onDelete(topic) }]
    : []

  return [edit, danger].filter((group) => group.length)
}

/** Tooltip of the default-subscription switch. */
function defaultTooltip(topic: TopicRow) {
  if (!canUpdate.value) return "You don't have permission"

  return topic.defaultSubscribed ? 'Subscribed by default' : 'Opt-in only'
}

function stats(topic: TopicRow) {
  const parts = [topic.defaultSubscribed ? 'Subscribed by default' : 'Opt-in only']

  if (topic.optedOutCount) parts.push(`${number(topic.optedOutCount)} opted out`)

  if (topic.optedInCount) parts.push(`${number(topic.optedInCount)} opted in`)

  return parts.join(' · ')
}

const USwitch = resolveComponent('USwitch')
const UTooltip = resolveComponent('UTooltip')

const columns = computed<TableColumn<TopicRow>[]>(() => [
  {
    accessorKey: 'name',
    header: 'Topic',
    cell: ({ row }) =>
      h('div', { class: 'min-w-0' }, [
        h('p', { class: 'truncate font-medium text-highlighted' }, row.original.name),
        row.original.description
          ? h('p', { class: 'truncate text-muted' }, row.original.description)
          : null,
        h('p', { class: 'mt-0.5 truncate text-xs text-muted tabular-nums' }, stats(row.original))
      ])
  },
  {
    accessorKey: 'defaultSubscribed',
    header: 'Default',
    meta: { class: { th: 'w-24', td: 'w-24' } },
    // A disabled switch cannot be focused: the wrapper carries the tooltip for keyboard users.
    cell: ({ row }) =>
      h(UTooltip, { text: defaultTooltip(row.original) }, () =>
        h('span', { class: 'inline-flex', tabindex: canUpdate.value ? undefined : 0 }, [
          h(USwitch, {
            modelValue: row.original.defaultSubscribed,
            loading: toggling.value.has(row.original.id),
            disabled: !canUpdate.value,
            'aria-label': `Subscribe contacts to ${row.original.name} by default`,
            'onUpdate:modelValue': (value: boolean) => toggleDefault(row.original, value)
          })
        ])
      )
  },
  rowActionsColumn({ items: rowActions, label: (topic) => `Actions for ${topic.name}` })
])
</script>

<template>
  <SettingsCard
    title="Topics"
    description="Notification categories contacts can opt out of in the preference center. Pick a topic on a broadcast to respect those choices."
    stacked
  >
    <template #headerActions>
      <Can v-slot="{ allowed }" :permission="{ topic: ['create'] }" :explain="NO_PERMISSION">
        <UTooltip text="New topic" :kbds="['n']" :disabled="!allowed">
          <UButton
            label="New topic"
            icon="i-lucide-plus"
            :disabled="!allowed"
            @click="openForm()"
          />
        </UTooltip>
      </Can>
    </template>

    <UInput
      v-if="searchable && !error"
      ref="search"
      v-model="search"
      icon="i-lucide-search"
      placeholder="Search topics…"
      aria-label="Search topics"
      class="w-full sm:w-64"
    >
      <template #trailing>
        <UKbd value="/" />
      </template>
    </UInput>

    <EmptyState
      v-if="error"
      variant="error"
      title="Topics could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        :loading="status === 'pending'"
        @click="() => refresh()"
      />
    </EmptyState>

    <UTable
      v-else-if="filtered.length || (status === 'pending' && !topics.length)"
      :data="filtered"
      :columns="columns"
      :loading="status === 'pending'"
      caption="Topics"
      :ui="tableUi"
    />

    <EmptyState
      v-else-if="!topics.length"
      icon="i-lucide-tags"
      title="No topics yet"
      description="Create topics like “Product updates” or “Events” so contacts can choose what they receive instead of unsubscribing from everything."
      appearance="outline"
      compact
    >
      <UButton
        v-if="canCreate"
        label="New topic"
        icon="i-lucide-plus"
        variant="outline"
        @click="openForm()"
      />
    </EmptyState>

    <EmptyState
      v-else
      variant="no-results"
      :title="`No topics match “${search}”`"
      appearance="outline"
      compact
    >
      <UButton label="Clear search" variant="outline" @click="search = ''" />
    </EmptyState>
  </SettingsCard>
</template>
