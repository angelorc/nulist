<script setup lang="ts">
import type { LimitFieldGroup } from '#shared/schemas/organization'
import type { LimitSettings } from '#shared/types/domain'

/**
 * The number fields of one limit group (LIMIT_FIELD_GROUPS), editing `limits`
 * in place (the editable copy owned by a SettingsDocument or a form).
 * Read-only with `disabled`.
 */
defineProps<{ group: LimitFieldGroup; limits: LimitSettings; disabled?: boolean }>()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UFormField
      v-for="field in group.fields"
      :key="field.key"
      :label="field.label"
      :name="field.key"
      :help="field.help"
      :hint="limits[field.key] ? field.unit : 'No limit'"
    >
      <UInputNumber
        v-model="limits[field.key]"
        :min="0"
        :step="field.step ?? 1"
        :disabled="disabled"
        class="w-full"
      />
    </UFormField>
  </div>
</template>
