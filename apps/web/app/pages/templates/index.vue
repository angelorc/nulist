<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import { z } from 'zod'
import { TemplatesFormModal } from '#components'
import { templateKindSchema } from '#shared/schemas/templates'
import type { TemplateSummaryDto } from '#shared/schemas/templates'
import type { TemplateKind } from '#shared/types/domain'

definePageMeta({ permission: { template: ['read'] } })

useSeoMeta({ title: 'Templates' })

/** Filters kept in the URL; anything unexpected falls back to the default. */
const routeQuerySchema = z.object({
  kind: templateKindSchema.optional().catch(undefined),
  q: z.string().catch('').default('')
})

const route = useRoute()
const router = useRouter()
const { can } = useOrganization()
const canCreate = computed(() => can({ template: ['create'] }))
const initialQuery = routeQuerySchema.parse(route.query)
const searchInput = useTemplateRef('search')

const kind = ref<'all' | TemplateKind>(initialQuery.kind ?? 'all')

const q = ref(initialQuery.q)
const debouncedQ = refDebounced(q, 250)

const query = computed(() => ({
  preview: '1',
  kind: kind.value === 'all' ? undefined : kind.value,
  q: debouncedQ.value || undefined
}))

watch(query, (value) => {
  router.replace({ query: { ...route.query, kind: value.kind, q: value.q } })
})

const {
  data: templates,
  status,
  error,
  refresh
} = await useFetch<TemplateSummaryDto[]>('/api/templates', {
  query,
  default: () => []
})

const loading = computed(() => status.value === 'pending')
const isFiltered = computed(() => kind.value !== 'all' || !!debouncedQ.value)

const tabs: TabsItem[] = [
  { label: 'All', value: 'all' },
  { label: 'Marketing', value: 'marketing', icon: 'i-lucide-megaphone' },
  { label: 'Transactional', value: 'transactional', icon: 'i-lucide-zap' }
]

function clearFilters() {
  kind.value = 'all'
  q.value = ''
}

const overlay = useOverlay()
const formModal = overlay.create(TemplatesFormModal)

async function openCreate() {
  if (!canCreate.value) return

  const created = await formModal.open({ kind: kind.value === 'all' ? undefined : kind.value })
    .result

  if (created) await navigateTo(`/templates/${created.id}`)
}

// ⌘K "New template" lands here with ?new=1 (opens the form only for members who may create).
onMounted(() => {
  if (!route.query.new) return
  router.replace({ query: { ...route.query, new: undefined } })

  if (canCreate.value) void openCreate()
})

// `n` creates (only for members who may), `/` searches.
defineShortcuts(
  computed(() => ({
    n: canCreate.value ? () => void openCreate() : false,
    '/': () => searchInput.value?.inputRef?.focus()
  }))
)

const confirm = useConfirm()

const { run: duplicate } = useApiAction(
  (id: string) => $fetch<{ id: string }>(`/api/templates/${id}/duplicate`, { method: 'POST' }),
  { success: 'Template duplicated' }
)

async function onDuplicate(template: TemplateSummaryDto) {
  if (await duplicate(template.id)) await refresh()
}

const { run: remove } = useApiAction(
  (id: string) => $fetch<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  { success: 'Template deleted' }
)

async function onDelete(template: TemplateSummaryDto) {
  const ok = await confirm({
    title: `Delete "${template.name}"?`,
    description:
      template.kind === 'transactional'
        ? `API requests that use "${template.slug}" will start failing. This can't be undone.`
        : "Broadcasts that already went out keep their content. This can't be undone.",
    confirmLabel: 'Delete template',
    danger: true
  })

  if (ok && (await remove(template.id)) !== undefined) await refresh()
}
</script>

<template>
  <UDashboardPanel id="templates">
    <template #header>
      <UDashboardNavbar title="Templates">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <Can
            v-slot="{ allowed }"
            :permission="{ template: ['create'] }"
            explain="You don't have permission to create templates"
          >
            <UTooltip text="New template" :kbds="['n']" :disabled="!allowed">
              <UButton
                label="New template"
                icon="i-lucide-plus"
                :disabled="!allowed"
                @click="openCreate"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        :ui="{ root: 'flex-wrap gap-y-2 py-2 sm:py-0', right: 'w-full sm:w-auto' }"
      >
        <template #left>
          <UTabs
            v-model="kind"
            :items="tabs"
            :content="false"
            size="xs"
            color="neutral"
            aria-label="Filter by type"
            :ui="{ list: 'w-auto' }"
          />
        </template>
        <template #right>
          <UInput
            ref="search"
            v-model="q"
            icon="i-lucide-search"
            placeholder="Search templates…"
            size="sm"
            class="w-full sm:w-64"
            aria-label="Search templates"
          >
            <template #trailing>
              <UKbd value="/" class="hidden sm:inline-flex" />
            </template>
          </UInput>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <EmptyState
        v-if="error && !loading"
        variant="error"
        appearance="outline"
        title="Couldn't load templates"
        :description="apiErrorMessage(error)"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          variant="outline"
          @click="() => refresh()"
        />
      </EmptyState>

      <TemplatesGridSkeleton v-else-if="loading && !templates.length" />

      <ul
        v-else-if="templates.length"
        class="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 transition-opacity"
        :class="loading && 'opacity-60'"
        :aria-busy="loading"
      >
        <li v-for="template in templates" :key="template.id" class="min-w-0">
          <TemplatesCard :template="template" @duplicate="onDuplicate" @delete="onDelete" />
        </li>
      </ul>

      <EmptyState
        v-else-if="isFiltered"
        variant="no-results"
        appearance="outline"
        title="No templates match your filters"
        description="Try another type or search term."
      >
        <UButton label="Clear filters" variant="outline" @click="clearFilters" />
      </EmptyState>

      <EmptyState
        v-else-if="canCreate"
        icon="i-lucide-layout-template"
        appearance="outline"
        title="Create your first template"
        description="Design reusable emails with the visual editor or write MJML by hand."
      >
        <UButton label="New template" icon="i-lucide-plus" @click="openCreate" />
      </EmptyState>

      <EmptyState
        v-else
        icon="i-lucide-layout-template"
        appearance="outline"
        title="No templates yet"
        description="Templates created by your team appear here."
      />

      <TableFooter
        v-if="!error"
        :total="templates.length"
        :page-size="templates.length"
        noun="template"
      />
    </template>
  </UDashboardPanel>
</template>
