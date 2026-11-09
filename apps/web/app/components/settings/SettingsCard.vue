<script setup lang="ts">
import type { z } from 'zod'

/**
 * A settings section (DESIGN.md §4): title and description on the left, fields on the right,
 * one Save button enabled only when the section is dirty, Discard only while it is dirty.
 * Read-only sections (no permission) disable the fields and hide Save.
 * Bind it to a SettingsDocument with `v-bind="group([...keys])"`.
 *
 * `stacked` puts lists and tables full width under the heading; `#headerActions` holds the
 * section's primary action, top right.
 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    schema?: z.ZodType
    state?: object
    dirty?: boolean
    saving?: boolean
    readonly?: boolean
    saveLabel?: string
    /** Full-width content under the heading, for lists and tables. */
    stacked?: boolean
  }>(),
  {
    description: undefined,
    schema: undefined,
    state: undefined,
    saveLabel: 'Save',
    stacked: false
  }
)

const emit = defineEmits<{ submit: []; discard: [] }>()
const slots = useSlots()
</script>

<template>
  <UPageCard
    :title="title"
    :description="description"
    :orientation="stacked ? 'vertical' : 'horizontal'"
    variant="outline"
    :ui="{
      container: stacked
        ? 'gap-y-5'
        : 'lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start gap-y-5',
      wrapper: slots.headerActions ? 'items-stretch' : undefined
    }"
  >
    <template v-if="slots.headerActions" #body>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 basis-60">
          <h2 class="text-base text-pretty font-semibold text-highlighted">
            {{ title }}
          </h2>
          <div v-if="description || slots.description" class="mt-1 text-sm text-pretty text-muted">
            <slot name="description">
              {{ description }}
            </slot>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <slot name="headerActions" />
        </div>
      </div>
    </template>
    <template v-else #title>
      <h2>{{ title }}</h2>
    </template>
    <template v-if="slots.description && !slots.headerActions" #description>
      <slot name="description" />
    </template>

    <UForm
      v-if="state"
      :schema="schema"
      :state="state"
      :disabled="readonly"
      class="min-w-0 space-y-4"
      @submit="emit('submit')"
    >
      <slot />
      <div
        v-if="!readonly || slots.actions"
        class="flex flex-wrap items-center justify-end gap-2 border-t border-default pt-4"
      >
        <slot name="actions" />
        <template v-if="!readonly">
          <UButton v-if="dirty" label="Discard" variant="ghost" @click="emit('discard')" />
          <UButton type="submit" :label="saveLabel" :disabled="!dirty" :loading="saving" />
        </template>
      </div>
    </UForm>

    <div v-else class="min-w-0 space-y-4">
      <slot />
      <div
        v-if="slots.actions"
        class="flex flex-wrap items-center justify-end gap-2 border-t border-default pt-4"
      >
        <slot name="actions" />
      </div>
    </div>
  </UPageCard>
</template>
