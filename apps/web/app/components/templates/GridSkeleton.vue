<script setup lang="ts">
/** Loading placeholder shaped like the template grid of {@link TemplatesCard} cards. */
withDefaults(defineProps<{ count?: number }>(), { count: 6 })
</script>

<template>
  <ul
    class="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"
    aria-busy="true"
    aria-label="Loading templates"
  >
    <li v-for="i in count" :key="i">
      <UPageCard
        variant="outline"
        :ui="{
          root: 'overflow-hidden',
          container: 'min-w-0 p-0 sm:p-0 gap-0 lg:flex',
          header: 'mb-0 w-full border-b border-default',
          body: 'w-full space-y-2 px-3 pt-3',
          footer: 'flex items-center gap-2 w-full px-3 pt-2.5 pb-3 mt-0'
        }"
      >
        <template #header>
          <USkeleton class="aspect-[4/3] w-full rounded-none" />
        </template>
        <template #body>
          <USkeleton class="h-4 w-2/3" />
          <USkeleton class="h-3 w-1/2" />
        </template>
        <template #footer>
          <USkeleton class="h-5 w-24" />
          <USkeleton class="ms-auto h-3 w-16" />
        </template>
      </UPageCard>
    </li>
  </ul>
</template>
