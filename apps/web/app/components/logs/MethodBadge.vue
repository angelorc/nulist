<script setup lang="ts">
/** HTTP method of a logged API request, as a neutral outline label (DESIGN.md §5 badges). */
defineProps<{ method: string }>()
</script>

<template>
  <UBadge :label="method" variant="outline" class="font-mono min-w-14 justify-center" />
</template>
