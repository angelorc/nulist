<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { templateTestSchema } from '#shared/schemas/templates'
import type { TemplateTestInput, TemplateTestResult } from '#shared/schemas/templates'

/**
 * "Send test" popover: remembers the last address, saves pending changes first.
 * Rendered only for members with `template:update` (the server route requires it).
 */
const props = defineProps<{
  templateId: string
  /** Runs before sending (e.g. save unsaved changes). Return false to abort. */
  beforeSend?: () => Promise<boolean>
}>()

const open = ref(false)
const { user } = useUserSession()
const lastAddress = useLocalStorage('mlist:test-email', '')
const state = reactive<TemplateTestInput>({ to: lastAddress.value || user.value?.email || '' })
const notify = useNotify()

const { run, pending } = useApiAction(
  (to: string) =>
    $fetch<TemplateTestResult>(`/api/templates/${props.templateId}/test`, {
      method: 'POST',
      body: { to }
    }),
  { error: 'Test email not sent' }
)

async function onSubmit(event: FormSubmitEvent<TemplateTestInput>) {
  if (props.beforeSend && !(await props.beforeSend())) return
  const result = await run(event.data.to)

  if (!result) return
  lastAddress.value = event.data.to

  if (result.status === 'sent') {
    notify.success(`Test sent to ${event.data.to}`, {
      description: 'Sample data was used for every variable.',
      icon: 'i-lucide-send'
    })
    open.value = false
  } else {
    notify.error('Test email not sent', undefined, { description: result.error })
  }
}
</script>

<template>
  <Can :permission="{ template: ['update'] }">
    <UPopover v-model:open="open" :content="{ align: 'end', sideOffset: 8 }">
      <UButton
        label="Send test"
        icon="i-lucide-send"
        variant="outline"
        :ui="{ label: 'hidden md:inline' }"
        aria-label="Send test email"
      />

      <template #content>
        <UForm
          :schema="templateTestSchema"
          :state="state"
          class="w-[min(20rem,calc(100vw-2rem))] p-4 space-y-3"
          aria-labelledby="send-test-title"
          @submit="onSubmit"
        >
          <div>
            <p id="send-test-title" class="text-sm font-medium text-highlighted">
              Send a test email
            </p>
            <p class="text-[13px] text-muted mt-0.5">
              Unsaved changes are saved first. Variables use sample data.
            </p>
          </div>
          <UFormField name="to" label="Recipient" required>
            <UInput
              v-model="state.to"
              type="email"
              placeholder="you@example.com"
              class="w-full"
              autofocus
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" size="sm" @click="open = false" />
            <UButton type="submit" label="Send test" size="sm" :loading="pending" />
          </div>
        </UForm>
      </template>
    </UPopover>
  </Can>
</template>
