<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { LIMIT_FIELD_GROUPS, organizationLimitsSchema } from '#shared/schemas/organization'
import type { AdminOrganizationLimits } from '#shared/schemas/organization'
import type { LimitSettings } from '#shared/types/domain'

/** An organization's quotas with its current usage (instance administrators; 0 = no limit). */
const props = defineProps<{ organizationId: string; organizationName: string }>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const url = computed(() => `/api/admin/organizations/${props.organizationId}/limits`)

const { data, status, error, refresh } = useFetch<AdminOrganizationLimits>(url, {
  server: false,
  lazy: true
})

const state = ref<LimitSettings | null>(null)

watch(
  data,
  (value) => {
    if (value) state.value = { ...value.limits }
  },
  { immediate: true }
)

const { run, pending } = useApiAction(
  (limits: LimitSettings) => {
    const target: string = url.value

    return $fetch<AdminOrganizationLimits>(target, { method: 'PUT', body: limits })
  },
  { success: `Limits of ${props.organizationName} updated`, error: 'Could not update the limits' }
)

async function onSubmit(event: FormSubmitEvent<LimitSettings>) {
  if (await run(event.data)) emit('close', true)
}
</script>

<template>
  <UModal
    :title="`Limits of ${organizationName}`"
    description="Quotas for this organization's members and API keys. Set 0 for no limit."
    :ui="{ content: 'sm:max-w-2xl' }"
    @update:open="(open: boolean) => !open && emit('close', false)"
  >
    <template #body>
      <EmptyState
        v-if="error"
        variant="error"
        title="Limits could not be loaded"
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
      <div v-else-if="!state || status === 'pending'" class="space-y-6" aria-busy="true">
        <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div v-for="n in 3" :key="n" class="space-y-2">
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-1 w-full" />
          </div>
        </div>
        <div v-for="group in 2" :key="group" class="space-y-3 pt-5 border-t border-default">
          <USkeleton class="h-4 w-40" />
          <div class="grid gap-4 sm:grid-cols-2">
            <div v-for="n in 2" :key="n" class="space-y-1.5">
              <USkeleton class="h-4 w-24" />
              <USkeleton class="h-8 w-full" />
            </div>
          </div>
        </div>
      </div>
      <div v-else class="space-y-6">
        <div v-if="data?.usage.length" class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <SettingsUsageMeter
            v-for="item in data.usage"
            :key="item.key"
            :label="item.label"
            :used="item.used"
            :limit="item.limit"
            :unit="item.unit"
          />
        </div>
        <UForm
          id="admin-limits-form"
          :schema="organizationLimitsSchema"
          :state="state"
          class="space-y-6"
          @submit="onSubmit"
        >
          <section
            v-for="group in LIMIT_FIELD_GROUPS"
            :key="group.id"
            class="space-y-3 pt-5 border-t border-default"
          >
            <div>
              <h3 class="text-sm font-semibold text-highlighted">{{ group.title }}</h3>
              <p class="text-[13px] text-muted">{{ group.description }}</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                v-for="field in group.fields"
                :key="field.key"
                :label="field.label"
                :name="field.key"
                :help="field.help"
                :hint="state[field.key] ? field.unit : 'No limit'"
              >
                <UInputNumber
                  v-model="state[field.key]"
                  :min="0"
                  :step="field.step ?? 1"
                  class="w-full"
                />
              </UFormField>
            </div>
          </section>
        </UForm>
      </div>
    </template>
    <template #footer>
      <UButton label="Cancel" variant="ghost" @click="emit('close', false)" />
      <UButton
        type="submit"
        form="admin-limits-form"
        label="Save limits"
        :disabled="!state"
        :loading="pending"
      />
    </template>
  </UModal>
</template>
