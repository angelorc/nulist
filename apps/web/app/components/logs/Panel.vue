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
 * own filter toolbar in the header; the view's description and content in the body.
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
  emails:
    'Every email mlist sent or tried to send, with its delivery timeline and rendered content.',
  api: 'Requests made to the REST API with an API key, including the request and response payloads.',
  events: 'Raw notifications received from Amazon SES through SNS, and how each one was handled.'
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
      <p class="text-sm text-muted">
        {{ DESCRIPTIONS[tab] }}
      </p>

      <slot />
    </template>
  </UDashboardPanel>
</template>
