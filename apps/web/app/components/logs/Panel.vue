<script lang="ts">
import { z } from 'zod'

/** The log views of the Logs page, one per tab (`?tab=`). */
export const logTabSchema = z.enum(['emails', 'api', 'events'])

export type LogTab = z.infer<typeof logTabSchema>
</script>

<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { VNode } from 'vue'
import type { DateRangeValue } from '~/utils/logLinks'

/**
 * Frame shared by the log views (DESIGN.md §4): the facets panel on the left (a slideover
 * below lg), then the Logs navbar and one toolbar (view tabs · date range, filters, refresh)
 * above the view content.
 *
 * <LogsPanel v-model:tab="tab" v-model:range="range" :active="active" :loading="loading"
 *   refresh-label="Refresh emails" @clear="clear" @refresh="refreshAll">
 *   <template #facets>search · scope chips · facet groups</template>
 *   overview · table · footer · detail slideover
 * </LogsPanel>
 */
withDefaults(
  defineProps<{
    /** Number of active filters in the facets panel. */
    active: number
    loading?: boolean
    refreshLabel: string
  }>(),
  { loading: false }
)

const emit = defineEmits<{ clear: []; refresh: [] }>()

const tab = defineModel<LogTab>('tab', { required: true })

const range = defineModel<DateRangeValue>('range', { required: true })

defineSlots<{
  /** Search, scope chips and facet groups of the view. */
  facets?: () => VNode[]
  default?: () => VNode[]
}>()

const TABS = [
  { label: 'Emails', value: 'emails', icon: 'i-lucide-mail' },
  { label: 'API requests', value: 'api', icon: 'i-lucide-terminal' },
  { label: 'SES events', value: 'events', icon: 'i-lucide-radio-tower' }
] satisfies TabsItem[]

const DESCRIPTIONS: Record<LogTab, string> = {
  emails: 'Every email sent or attempted, with its delivery timeline',
  api: 'REST API requests made with an API key',
  events: 'Delivery, bounce, complaint, open and click notifications from Amazon SES'
}

const filtersOpen = ref(false)

function onTab(value: string | number) {
  const parsed = logTabSchema.safeParse(value)

  if (parsed.success) tab.value = parsed.data
}
</script>

<template>
  <FacetsPanel id="logs-facets" v-model:open="filtersOpen" :active="active" @clear="emit('clear')">
    <slot name="facets" />
  </FacetsPanel>

  <UDashboardPanel id="logs">
    <template #header>
      <UDashboardNavbar title="Logs">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #trailing>
          <span class="hidden md:inline text-[13px] text-muted truncate">
            {{ DESCRIPTIONS[tab] }}
          </span>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar :ui="{ root: 'flex-wrap gap-y-2 py-2', right: 'ms-auto' }">
        <template #left>
          <UTabs
            :model-value="tab"
            :items="TABS"
            :content="false"
            size="sm"
            aria-label="Log type"
            @update:model-value="onTab"
          />
        </template>
        <template #right>
          <DateRangePicker v-model="range" any-time size="sm" />
          <FacetsButton v-model:open="filtersOpen" :active="active" size="sm" />
          <UTooltip text="Refresh">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="refreshLabel"
              :loading="loading"
              @click="emit('refresh')"
            />
          </UTooltip>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
