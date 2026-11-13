<template>
  <div
    class="relative min-h-dvh flex flex-col items-center justify-center gap-10 bg-default px-4 py-12 bg-[radial-gradient(ellipse_at_top,var(--ui-bg-elevated),transparent_60%)]"
  >
    <header>
      <img src="/brand/logo-light.svg" alt="nulist" class="h-10 w-auto dark:hidden" />
      <img src="/brand/logo-dark.svg" alt="nulist" class="hidden h-10 w-auto dark:block" />
    </header>
    <main class="w-full max-w-sm">
      <slot />
    </main>
    <footer class="text-xs text-dimmed">Email marketing and transactional delivery</footer>
  </div>
</template>
