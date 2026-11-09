<script setup lang="ts">
import type { ConnectionTestResult } from '#shared/schemas/domains'

/**
 * "Test connection" button with an inline result. Tests the unsaved form
 * values (`draft`) so problems show up before saving. When disabled,
 * `disabledReason` explains why in a tooltip.
 */
const props = defineProps<{
  endpoint: string
  draft: object
  disabled?: boolean
  disabledReason?: string
  label?: string
}>()

const result = ref<{ ok: boolean; message: string } | null>(null)
const pending = ref(false)

async function test() {
  pending.value = true
  result.value = null

  try {
    const url: string = props.endpoint

    const response = await $fetch<ConnectionTestResult>(url, {
      method: 'POST',
      body: { draft: toRaw(props.draft) }
    })

    result.value = { ok: true, message: `${response.message} (${response.durationMs} ms)` }
  } catch (error) {
    result.value = { ok: false, message: apiErrorMessage(error) }
  } finally {
    pending.value = false
  }
}

// A changed form invalidates the previous result.
watch(
  () => JSON.stringify(props.draft),
  () => {
    result.value = null
  }
)
</script>

<template>
  <div class="me-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2">
    <!-- A disabled button cannot be focused or hovered: the wrapper carries the tooltip then. -->
    <UTooltip :text="disabledReason" :disabled="!disabled || !disabledReason">
      <span class="inline-flex" :tabindex="disabled && disabledReason ? 0 : undefined">
        <UButton
          :label="label ?? 'Test connection'"
          icon="i-lucide-plug-zap"
          variant="outline"
          :loading="pending"
          :disabled="disabled"
          @click="test"
        />
      </span>
    </UTooltip>
    <!-- The live region stays mounted so each new result is announced. -->
    <div role="status" class="min-w-0 empty:hidden">
      <p
        v-if="result"
        class="flex items-start gap-1.5 text-[13px]"
        :class="result.ok ? 'text-success' : 'text-error'"
      >
        <UIcon
          :name="result.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          class="mt-px size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="line-clamp-2 break-words" :title="result.message">{{ result.message }}</span>
      </p>
    </div>
  </div>
</template>
