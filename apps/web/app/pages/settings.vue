<script setup lang="ts">
/**
 * Settings shell: child pages in app/pages/settings/* render only their content (a stack of
 * SettingsCard sections), never their own UDashboardPanel. The sub-navigation comes from
 * useNavigation (filtered by the member's role).
 */
const { settings: links } = useNavigation()
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-10' }">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar>
        <UNavigationMenu
          :items="links"
          highlight
          aria-label="Settings sections"
          class="-mx-1 flex-1"
          :ui="{ item: 'shrink-0' }"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full flex-col gap-6 sm:gap-8 lg:max-w-3xl">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
