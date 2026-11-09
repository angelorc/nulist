<script setup lang="ts">
const props = defineProps<{ date: string | Date | null | undefined; fallback?: string }>()
const { relative, dateTime } = useFormat()
const now = useRelativeNow()
const value = computed(() => (props.date ? new Date(props.date) : null))
</script>

<template>
  <UTooltip v-if="value" :text="dateTime(value)">
    <time :datetime="value.toISOString()" class="tabular-nums whitespace-nowrap">{{
      relative(value, now)
    }}</time>
  </UTooltip>
  <span v-else class="text-dimmed">{{ fallback ?? '—' }}</span>
</template>
