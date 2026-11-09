<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/** Inserts a personalisation variable (Liquid) into a text field. */
const emit = defineEmits<{ insert: [snippet: string] }>()

const VARIABLES = [
  { label: 'First name', snippet: '{{ contact.first_name | default: "there" }}' },
  { label: 'Last name', snippet: '{{ contact.last_name }}' },
  { label: 'Email', snippet: '{{ contact.email }}' },
  { label: 'Company name', snippet: '{{ company.name }}' }
]

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', label: 'Insert variable' }],
  VARIABLES.map((v) => ({
    label: v.label,
    description: v.snippet,
    onSelect: () => emit('insert', v.snippet)
  }))
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
    :ui="{ content: 'w-72', itemDescription: 'font-mono text-xs' }"
  >
    <UTooltip text="Insert variable">
      <UButton icon="i-lucide-braces" size="sm" variant="ghost" aria-label="Insert variable" />
    </UTooltip>
  </UDropdownMenu>
</template>
