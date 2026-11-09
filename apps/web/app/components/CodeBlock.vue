<script setup lang="ts">
/**
 * Read-only code sample with a copy button: API quickstarts, verification snippets, JSON
 * (DESIGN.md §5 "Code & IDs"). The block scrolls past `maxHeight` and is keyboard-scrollable.
 *
 * <CodeBlock :code="snippet" label="cURL example" />
 */
const props = withDefaults(
  defineProps<{
    code: string
    /** Names the block for assistive technology and the copy button ("Copy cURL example"). */
    label: string
    maxHeight?: string
  }>(),
  { maxHeight: '24rem' }
)
</script>

<template>
  <div class="group relative min-w-0">
    <pre
      class="text-xs font-mono leading-5 text-default bg-elevated/60 ring ring-default rounded-md p-3 pr-12 overflow-auto"
      :style="{ maxHeight: props.maxHeight }"
      tabindex="0"
      role="region"
      :aria-label="label"
    ><code>{{ code }}</code></pre>
    <CopyButton
      :value="code"
      :label="label"
      variant="outline"
      class="absolute top-2 right-2 bg-default rounded-md transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100"
    />
  </div>
</template>
