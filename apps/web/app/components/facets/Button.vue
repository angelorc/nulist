<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

withDefaults(
  defineProps<{
    active: number
    size?: ButtonProps['size']
  }>(),
  { size: undefined }
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UButton
    label="Filters"
    icon="i-lucide-sliders-horizontal"
    color="neutral"
    variant="outline"
    :size="size"
    :aria-expanded="open"
    :aria-label="active > 0 ? `Filters, ${active} active` : 'Filters'"
    class="lg:hidden"
    @click="open = true"
  >
    <template v-if="active > 0" #trailing>
      <UBadge :label="active" color="primary" variant="solid" class="tabular-nums" />
    </template>
  </UButton>
</template>
