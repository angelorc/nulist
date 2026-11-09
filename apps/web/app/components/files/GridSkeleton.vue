<script setup lang="ts">
/** Loading placeholder shaped like the file grid of {@link FilesTile} cards. */
withDefaults(defineProps<{ count?: number }>(), { count: 12 })
</script>

<template>
  <ul
    class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4"
    aria-busy="true"
    aria-label="Loading files"
  >
    <li v-for="i in count" :key="i">
      <UPageCard
        variant="outline"
        :ui="{
          root: 'overflow-hidden',
          container: 'min-w-0 p-0 sm:p-0 gap-0 lg:flex',
          header: 'mb-0 w-full border-b border-default',
          body: 'w-full space-y-1.5 px-3 py-2.5'
        }"
      >
        <template #header>
          <USkeleton class="aspect-[4/3] w-full rounded-none" />
        </template>
        <template #body>
          <USkeleton class="h-3.5 w-3/4" />
          <USkeleton class="h-3 w-1/2" />
        </template>
      </UPageCard>
    </li>
  </ul>
</template>
