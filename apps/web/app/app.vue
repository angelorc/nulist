<script setup lang="ts">
const colorMode = useColorMode()
const themeColor = computed(() => (colorMode.value === 'dark' ? '#0a0a0a' : '#ffffff'))

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: themeColor }
  ],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' },
  titleTemplate: (title) => (title ? `${title} · nulist` : 'nulist')
})
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right', duration: 4000 }" :tooltip="{ delayDuration: 300 }">
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="2" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
