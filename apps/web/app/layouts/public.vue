<!--
  Frame of recipient-facing pages. Branding (name, logo, address) belongs to
  the organization behind each link, so PublicCard renders it from the page's
  payload instead of the layout. Mobile first: content starts near the top on
  phones (room for the keyboard under forms) and is centered from `sm` up.
-->
<template>
  <div class="min-h-dvh flex flex-col bg-elevated/50">
    <main class="flex-1 flex flex-col items-center px-4 py-8 sm:justify-center sm:py-16">
      <div class="w-full max-w-md">
        <slot />
      </div>
    </main>
  </div>
</template>
