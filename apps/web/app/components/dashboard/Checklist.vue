<script setup lang="ts">
import type { PermissionRequest } from '#shared/auth/permissions'
import type { OnboardingStep } from '#shared/types/analytics'

/**
 * First-run steps of the active organization. A step the member's role cannot
 * perform shows "Ask an admin" instead of a link; the checklist renders nothing
 * when none of the open steps is within the member's reach.
 */
const props = defineProps<{ steps: Record<OnboardingStep, boolean> }>()

defineEmits<{ dismiss: [] }>()

interface ChecklistItem {
  key: OnboardingStep
  title: string
  description: string
  to: string
  action: string
  /** What the step's page asks of the member's role. */
  permission: PermissionRequest
}

const ITEMS: ChecklistItem[] = [
  {
    key: 'sending',
    title: 'Configure sending',
    description: 'Connect Amazon SES or an SMTP server.',
    to: '/settings/sending',
    action: 'Configure',
    permission: { settings: ['update'] }
  },
  {
    key: 'domain',
    title: 'Verify your sending domain',
    description: 'Publish SPF, DKIM and DMARC records so mail reaches the inbox.',
    to: '/settings/domains',
    action: 'Verify',
    permission: { domain: ['create'] }
  },
  {
    key: 'list',
    title: 'Create a list',
    description: 'Lists hold the people who agreed to hear from you.',
    to: '/lists',
    action: 'Create list',
    permission: { list: ['create'] }
  },
  {
    key: 'contacts',
    title: 'Import contacts',
    description: 'Upload a CSV or add contacts through the API.',
    to: '/contacts/import',
    action: 'Import',
    permission: { contact: ['import'] }
  },
  {
    key: 'template',
    title: 'Design a template',
    description: 'Start from the default layout or write MJML.',
    to: '/templates?new=1',
    action: 'Create template',
    permission: { template: ['create'] }
  },
  {
    key: 'broadcast',
    title: 'Send your first broadcast',
    description: 'Pick an audience, write a subject and send.',
    to: '/broadcasts?new=1',
    action: 'New broadcast',
    permission: { broadcast: ['create'] }
  }
]

const { can } = useOrganization()
const NuxtLink = resolveComponent('NuxtLink')

const items = computed(() =>
  ITEMS.map((item) =>
    Object.assign({ done: props.steps[item.key], allowed: can(item.permission) }, item)
  )
)

const doneCount = computed(() => items.value.filter((i) => i.done).length)
const nextKey = computed(() => items.value.find((i) => !i.done && i.allowed)?.key)
const actionable = computed(() => nextKey.value !== undefined)

const titleId = useId()
</script>

<template>
  <UCard
    v-if="actionable"
    as="section"
    :aria-labelledby="titleId"
    :ui="{ root: 'divide-y-0 shrink-0', header: 'px-4 pt-4 pb-3 sm:px-4', body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 :id="titleId" class="text-base font-semibold text-highlighted">Get started</h2>
          <p class="text-[13px] text-muted mt-0.5 tabular-nums">
            {{ doneCount }} of {{ items.length }} steps done. Each step is checked automatically.
          </p>
        </div>
        <UTooltip text="Hide checklist">
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            size="sm"
            aria-label="Hide checklist"
            @click="$emit('dismiss')"
          />
        </UTooltip>
      </div>
      <UProgress
        :model-value="doneCount"
        :max="items.length"
        size="xs"
        class="mt-3"
        aria-hidden="true"
      />
    </template>

    <ol class="divide-y divide-default border-t border-default">
      <li v-for="(item, index) in items" :key="item.key">
        <component
          :is="item.allowed ? NuxtLink : 'div'"
          :to="item.allowed ? item.to : undefined"
          class="group flex items-center gap-3 px-4 py-3 transition-colors"
          :class="
            item.allowed &&
            'hover:bg-elevated/40 focus-visible:bg-elevated/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
          "
        >
          <span
            class="size-6 shrink-0 rounded-full grid place-items-center text-xs tabular-nums ring"
            :class="
              item.done
                ? 'bg-success/10 ring-success/30 text-success'
                : item.key === nextKey
                  ? 'ring-primary text-primary'
                  : 'ring-default text-muted'
            "
          >
            <UIcon v-if="item.done" name="i-lucide-check" class="size-3.5" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="block text-sm font-medium"
              :class="item.done ? 'text-muted line-through decoration-default' : 'text-highlighted'"
            >
              {{ item.title }}
            </span>
            <span class="block text-[13px] text-muted truncate">{{ item.description }}</span>
          </span>
          <span v-if="item.done" class="text-xs text-muted shrink-0">Done</span>
          <span v-else-if="!item.allowed" class="text-xs text-muted shrink-0">Ask an admin</span>
          <span
            v-else
            class="hidden sm:inline-flex items-center gap-1 text-[13px] shrink-0"
            :class="
              item.key === nextKey
                ? 'text-primary font-medium'
                : 'text-muted group-hover:text-highlighted'
            "
          >
            {{ item.action }}
            <UIcon name="i-lucide-chevron-right" class="size-4" />
          </span>
          <UIcon
            v-if="item.allowed && !item.done"
            name="i-lucide-chevron-right"
            class="sm:hidden size-4 shrink-0 text-muted"
          />
        </component>
      </li>
    </ol>
  </UCard>
</template>
