<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TemplateSummaryDto } from '#shared/schemas/templates'

/** A template in the grid: the whole card opens the editor, the `…` menu sits above it. */
const props = defineProps<{ template: TemplateSummaryDto }>()

const emit = defineEmits<{
  duplicate: [template: TemplateSummaryDto]
  delete: [template: TemplateSummaryDto]
}>()

const { can } = useOrganization()
const to = computed(() => `/templates/${props.template.id}`)
const canDuplicate = computed(() => can({ template: ['create'] }))
const canDelete = computed(() => can({ template: ['delete'] }))

const kind = computed(() =>
  props.template.kind === 'transactional'
    ? { label: 'Transactional', icon: 'i-lucide-zap' }
    : { label: 'Marketing', icon: 'i-lucide-megaphone' }
)

/** Row actions the member's role allows; the menu is hidden when none is left. */
const items = computed<DropdownMenuItem[][]>(() => {
  const main: DropdownMenuItem[] = [
    can({ template: ['update'] })
      ? { label: 'Edit', icon: 'i-lucide-pencil', to: to.value }
      : { label: 'Open', icon: 'i-lucide-eye', to: to.value }
  ]

  if (canDuplicate.value)
    main.push({
      label: 'Duplicate',
      icon: 'i-lucide-copy',
      onSelect: () => emit('duplicate', props.template)
    })

  const groups = [main]

  if (canDelete.value)
    groups.push([
      {
        label: 'Delete',
        icon: 'i-lucide-trash',
        color: 'error',
        onSelect: () => emit('delete', props.template)
      }
    ])

  return groups
})

/** The card itself opens the template, so a menu with only "Open"/"Edit" adds nothing. */
const hasActions = computed(() => canDuplicate.value || canDelete.value)
</script>

<template>
  <UPageCard
    :to="to"
    :title="template.name"
    variant="outline"
    class="h-full"
    :ui="{
      root: 'overflow-hidden hover:ring-accented',
      container: 'min-w-0 p-0 sm:p-0 gap-0 lg:flex',
      wrapper: 'min-w-0',
      header: 'relative mb-0 w-full aspect-[4/3] border-b border-default',
      body: 'w-full min-w-0 px-3 pt-2.5',
      title: 'text-sm font-medium truncate',
      description: 'mt-0.5 text-[13px] truncate',
      footer: 'flex items-center gap-1.5 w-full min-w-0 px-3 pt-2 pb-2.5 mt-0 text-xs text-muted'
    }"
  >
    <template #header>
      <TemplatesThumbnail :html="template.previewHtml" />
    </template>

    <template #description>
      <span v-if="template.subject">{{ template.subject }}</span>
      <span v-else class="italic">No subject yet</span>
    </template>

    <template #footer>
      <UBadge variant="outline" :icon="kind.icon" :label="kind.label" class="shrink-0" />
      <span v-if="template.slug" class="font-mono truncate">{{ template.slug }}</span>
      <span class="ms-auto shrink-0"><TimeAgo :date="template.updatedAt" /></span>
      <UDropdownMenu v-if="hasActions" :items="items" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis"
          variant="ghost"
          size="sm"
          class="relative z-10 -me-1.5 -my-1"
          :aria-label="`Actions for ${template.name}`"
        />
      </UDropdownMenu>
    </template>
  </UPageCard>
</template>
