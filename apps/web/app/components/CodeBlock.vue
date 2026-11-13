<script setup lang="ts">
/**
 * Read-only code viewer: API quickstarts, verification snippets, JSON, email text
 * (DESIGN.md §5 "Code & IDs"). Syntax-highlighted by `lang`, lines wrap by default, the body
 * scrolls past `maxHeight` and is keyboard-scrollable; the header toggles wrapping, expands the
 * block full screen and copies the code.
 *
 * <CodeBlock :code="snippet" label="cURL example" lang="shell" />
 */
import { createReusableTemplate, useResizeObserver } from '@vueuse/core'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    code: string
    /** Names the block in its header, for assistive technology and the copy button. */
    label: string
    lang?: CodeLanguage
    maxHeight?: string
    /** Initial wrapping; the header toggle changes it. */
    wrap?: boolean
    lineNumbers?: boolean
  }>(),
  { lang: 'text', maxHeight: 'min(28rem, 60vh)', wrap: true, lineNumbers: false }
)

const highlighter = new CodeHighlighter()

const [DefineLines, ReuseLines] = createReusableTemplate<{ numbered: boolean }>()

const wrapped = ref(props.wrap)
const expanded = ref(false)

trackNestedOverlay(expanded)

watch(
  () => props.wrap,
  (value) => {
    wrapped.value = value
  }
)

const lines = computed(() => highlighter.lines(props.code, props.lang))
const multiline = computed(() => lines.value.length > 1)
const gutterWidth = computed(() => `${String(lines.value.length).length}ch`)

const region = useTemplateRef<HTMLElement>('region')
const content = useTemplateRef<HTMLElement>('content')
const expandedRegion = useTemplateRef<HTMLElement>('expandedRegion')
const overflowing = ref(false)

function measure() {
  const element = region.value

  overflowing.value =
    !!element &&
    (element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1)
}

useResizeObserver([region, content], measure)

onMounted(measure)

watch([lines, wrapped], () => nextTick(measure))

function focusExpandedRegion(event: Event) {
  event.preventDefault()
  expandedRegion.value?.focus()
}

function hangingIndent(line: CodeLine) {
  const width = `${line.indent + 2}ch`

  return { paddingInlineStart: width, textIndent: `-${width}` }
}

const wrapLabel = computed(() => (wrapped.value ? 'Unwrap lines' : 'Wrap lines'))
</script>

<template>
  <DefineLines v-slot="{ numbered }">
    <code
      class="block font-mono text-xs/5"
      :class="wrapped ? 'whitespace-pre-wrap wrap-anywhere' : 'w-max min-w-full whitespace-pre'"
    >
      <span v-for="(line, index) in lines" :key="index" class="flex min-h-[1lh]">
        <span
          v-if="numbered"
          class="box-content shrink-0 pe-4 text-right whitespace-pre text-dimmed select-none tabular-nums"
          :style="{ width: gutterWidth }"
          aria-hidden="true"
          >{{ index + 1 }}</span
        ><span class="min-w-0 flex-1" :style="wrapped ? hangingIndent(line) : undefined"
          ><span
            v-for="(token, position) in line.tokens"
            :key="position"
            :class="token.className"
            >{{ token.text }}</span
          ></span
        >
      </span>
    </code>
  </DefineLines>

  <div
    class="flex min-w-0 flex-col overflow-hidden rounded-md bg-elevated/40 ring ring-default"
    v-bind="$attrs"
  >
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-default bg-elevated/60 ps-3 pe-1.5"
    >
      <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ label }}</span>
      <UTooltip :text="wrapLabel">
        <UButton
          icon="i-lucide-wrap-text"
          color="neutral"
          :variant="wrapped ? 'soft' : 'ghost'"
          size="xs"
          :aria-label="`Wrap lines in ${label}`"
          :aria-pressed="wrapped"
          @click="wrapped = !wrapped"
        />
      </UTooltip>
      <UTooltip v-if="overflowing" text="Expand">
        <UButton
          icon="i-lucide-maximize-2"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`Expand ${label}`"
          @click="expanded = true"
        />
      </UTooltip>
      <UTooltip text="Copy">
        <CopyButton :value="code" :label="label" />
      </UTooltip>
    </div>
    <div
      ref="region"
      class="scrollbar-thin min-h-0 overflow-auto p-3 text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      :style="{ maxHeight: props.maxHeight }"
      tabindex="0"
      role="region"
      :aria-label="label"
    >
      <div ref="content">
        <ReuseLines :numbered="lineNumbers && multiline" />
      </div>
    </div>
  </div>

  <UModal
    v-model:open="expanded"
    fullscreen
    :title="label"
    :content="{ onOpenAutoFocus: focusExpandedRegion }"
    :ui="{
      header: 'pe-14 sm:pe-16',
      wrapper: 'min-w-0 flex-1',
      body: 'flex min-h-0 overflow-hidden p-0 sm:p-0'
    }"
  >
    <template #actions>
      <UTooltip :text="wrapLabel">
        <UButton
          icon="i-lucide-wrap-text"
          color="neutral"
          :variant="wrapped ? 'soft' : 'ghost'"
          :aria-label="`Wrap lines in ${label}`"
          :aria-pressed="wrapped"
          @click="wrapped = !wrapped"
        />
      </UTooltip>
      <UTooltip text="Copy">
        <CopyButton :value="code" :label="label" size="md" />
      </UTooltip>
    </template>
    <template #body>
      <div
        ref="expandedRegion"
        class="scrollbar-thin min-h-0 flex-1 overflow-auto bg-elevated/40 p-4 text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-6"
        tabindex="0"
        role="region"
        :aria-label="label"
      >
        <ReuseLines :numbered="multiline" />
      </div>
    </template>
  </UModal>
</template>
