<script setup lang="ts">
import { z } from 'zod'

/**
 * Pretty-printed JSON viewer with a copy button (event payloads, audit data). Raw strings
 * (e.g. non-JSON bodies) are shown as-is.
 *
 * <JsonBlock :value="event.payload" max-height="16rem" />
 */
const props = withDefaults(defineProps<{ value: unknown; maxHeight?: string; label?: string }>(), {
  maxHeight: '24rem',
  label: 'JSON'
})

const text = computed(() => {
  const raw = z.string().safeParse(props.value)

  return raw.success ? raw.data : JSON.stringify(props.value, null, 2)
})
</script>

<template>
  <CodeBlock :code="text" :label="label" :max-height="maxHeight" />
</template>
