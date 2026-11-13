<script lang="ts">
import { z } from 'zod'

/** The log views of the Logs page, one per tab (`?tab=`). */
export const logTabSchema = z.enum(['emails', 'api', 'events'])

export type LogTab = z.infer<typeof logTabSchema>
</script>

<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { VNode } from 'vue'

/**
 * Frame shared by the log views (DESIGN.md §4): the Logs navbar, the view tabs and the view's
 * own filter toolbar in the header; the view content in the body.
 *
 * <LogsPanel v-model:tab="tab">
 *   <template #filters>search · selects</template>
 *   <template #actions>clear filters · refresh</template>
 *   table · footer · detail slideover
 * </LogsPanel>
 */
const tab = defineModel<LogTab>('tab', { required: true })

defineSlots<{
  /** Search and filters, start of the filter toolbar. */
  filters?: () => VNode[]
  /** "Clear filters" and refresh, end of the filter toolbar. */
  actions?: () => VNode[]
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

function onTab(value: string | number) {
  const parsed = logTabSchema.safeParse(value)

  if (parsed.success) tab.value = parsed.data
}
</script>

<template>
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

      <UDashboardToolbar>
        <UTabs
          :model-value="tab"
          :items="TABS"
          :content="false"
          size="sm"
          aria-label="Log type"
          @update:model-value="onTab"
        />
      </UDashboardToolbar>

      <UDashboardToolbar
        :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'flex-wrap', right: 'ms-auto' }"
      >
        <template #left>
          <slot name="filters" />
        </template>
        <template #right>
          <slot name="actions" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
