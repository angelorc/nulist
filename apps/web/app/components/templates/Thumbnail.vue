<script setup lang="ts">
/**
 * Live, non-interactive miniature of an email: the HTML is rendered at email
 * width in a sandboxed iframe and scaled down to the container. The iframe is
 * only created once the thumbnail scrolls into view. Scripts stay disabled;
 * allow-same-origin lets images load from local or private storage hosts,
 * which browsers block for opaque-origin frames.
 */
const props = withDefaults(defineProps<{ html?: string | null; width?: number }>(), { width: 640 })

const container = useTemplateRef<HTMLElement>('container')
const { width: boxWidth, height: boxHeight } = useElementSize(container)
const visible = useElementVisibility(container, { rootMargin: '200px' })
const seen = ref(false)

watch(
  visible,
  (value) => {
    if (value) seen.value = true
  },
  { immediate: true }
)

/** Thumbnails never scroll: hide the frame's scrollbars without touching the email's own styles. */
const NO_SCROLL = '<style>html,body{overflow:hidden!important;scrollbar-width:none}</style>'

const srcdoc = computed(() => {
  if (!props.html) return ''

  return /<\/head>/i.test(props.html)
    ? props.html.replace(/<\/head>/i, `${NO_SCROLL}</head>`)
    : NO_SCROLL + props.html
})

const scale = computed(() => (boxWidth.value ? boxWidth.value / props.width : 0.4))

const frameStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${Math.ceil((boxHeight.value || 300) / scale.value)}px`,
  transform: `scale(${scale.value})`
}))
</script>

<template>
  <div ref="container" class="absolute inset-0 overflow-hidden bg-white" aria-hidden="true">
    <iframe
      v-if="seen && html"
      :srcdoc="srcdoc"
      scrolling="no"
      sandbox="allow-same-origin"
      tabindex="-1"
      loading="lazy"
      title="Template preview"
      class="pointer-events-none origin-top-left border-0 select-none"
      :style="frameStyle"
    />
    <div v-else-if="!html" class="absolute inset-0 grid place-items-center bg-elevated/50">
      <UIcon name="i-lucide-layout-template" class="size-6 text-muted" />
    </div>
  </div>
</template>
