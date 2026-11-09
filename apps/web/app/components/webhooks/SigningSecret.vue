<script setup lang="ts">
/**
 * The endpoint's signing secret: hidden until revealed, copyable, and rotatable by members who
 * manage endpoints (behind a confirmation, since the old secret stops working at once).
 */
const props = defineProps<{ endpointId: string; secret: string; canManage: boolean }>()
const emit = defineEmits<{ rotated: [secret: string] }>()

const revealed = ref(false)
const confirm = useConfirm()

const { run, pending } = useApiAction(
  () =>
    $fetch<{ id: string; secret: string }>(`/api/webhook-endpoints/${props.endpointId}/rotate`, {
      method: 'POST'
    }),
  { success: 'Signing secret rotated' }
)

async function rotate() {
  const ok = await confirm({
    title: 'Rotate the signing secret?',
    description:
      'The current secret stops working immediately. Requests signed with the new secret will fail verification until your receiver uses it.',
    confirmLabel: 'Rotate secret',
    danger: true
  })

  if (!ok) return
  const result = await run()

  if (!result) return
  revealed.value = true
  emit('rotated', result.secret)
}
</script>

<template>
  <div class="space-y-2">
    <UInput
      v-if="secret"
      :model-value="secret"
      :type="revealed ? 'text' : 'password'"
      readonly
      autocomplete="off"
      size="sm"
      class="w-full"
      aria-label="Signing secret"
      :ui="{ base: 'font-mono text-xs pe-16', trailing: 'pe-1 gap-0.5' }"
    >
      <template #trailing>
        <UTooltip :text="revealed ? 'Hide' : 'Reveal'">
          <UButton
            :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            size="xs"
            variant="ghost"
            :aria-label="revealed ? 'Hide secret' : 'Reveal secret'"
            @click="revealed = !revealed"
          />
        </UTooltip>
        <CopyButton :value="secret" label="signing secret" />
      </template>
    </UInput>
    <p v-else class="text-[13px] text-muted">
      You don't have permission to view the signing secret.
    </p>
    <UButton
      v-if="canManage"
      label="Rotate secret"
      icon="i-lucide-refresh-cw"
      size="sm"
      variant="outline"
      :loading="pending"
      @click="rotate"
    />
  </div>
</template>
