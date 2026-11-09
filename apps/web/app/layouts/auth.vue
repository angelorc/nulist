<template>
  <div class="min-h-dvh flex flex-col items-center justify-center gap-8 bg-default px-4 py-12">
    <header class="flex items-center gap-2">
      <UAvatar
        icon="i-lucide-mail"
        size="sm"
        aria-hidden="true"
        class="rounded-md bg-inverted"
        :ui="{ icon: 'size-4 text-inverted' }"
      />
      <span class="text-lg font-semibold text-highlighted">nulist</span>
    </header>
    <main class="w-full max-w-sm">
      <slot />
    </main>
  </div>
</template>
