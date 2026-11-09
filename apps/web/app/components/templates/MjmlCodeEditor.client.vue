<script setup lang="ts">
import { Codemirror } from 'vue-codemirror'
import { EditorView } from 'codemirror'
import { html } from '@codemirror/lang-html'
import type { TagSpec } from '@codemirror/lang-html'
import type { VNode } from 'vue'
import type { TemplateIssue, TemplatePreviewResult } from '#shared/schemas/templates'

/**
 * MJML code editor (CodeMirror) with a debounced server-rendered preview and
 * the list of MJML/Liquid issues (click to jump to the line). `readonly` (no
 * `template:update`) keeps the source selectable but not editable.
 */
const model = defineModel<string>({ required: true })

const props = defineProps<{
  subject?: string
  preheader?: string | null
  device: 'desktop' | 'mobile'
  readonly?: boolean
}>()

const emit = defineEmits<{ issues: [issues: TemplateIssue[]] }>()

/** `toolbar`: extra controls in the narrow-screen Code / Preview bar. */
defineSlots<{ toolbar?: () => VNode[] }>()

// MJML-aware completion ------------------------------------------------------
const box = {
  padding: null,
  'padding-top': null,
  'padding-right': null,
  'padding-bottom': null,
  'padding-left': null,
  'css-class': null,
  'mj-class': null
}

const text = {
  color: null,
  'font-family': null,
  'font-size': null,
  'font-weight': null,
  'line-height': null,
  'letter-spacing': null,
  align: ['left', 'center', 'right', 'justify']
}

const MJML_TAGS = {
  mjml: { children: ['mj-head', 'mj-body'], attrs: { lang: null, dir: ['ltr', 'rtl'] } },
  'mj-head': {
    children: [
      'mj-attributes',
      'mj-breakpoint',
      'mj-font',
      'mj-preview',
      'mj-style',
      'mj-title',
      'mj-raw'
    ]
  },
  'mj-attributes': {
    children: [
      'mj-all',
      'mj-class',
      'mj-text',
      'mj-button',
      'mj-image',
      'mj-section',
      'mj-column',
      'mj-divider'
    ]
  },
  'mj-all': { attrs: { 'font-family': null, padding: null, color: null } },
  'mj-class': { attrs: { name: null, ...text, ...box } },
  'mj-font': { attrs: { name: null, href: null } },
  'mj-style': { attrs: { inline: ['inline'] } },
  'mj-preview': {},
  'mj-title': {},
  'mj-breakpoint': { attrs: { width: null } },
  'mj-body': {
    attrs: { 'background-color': null, width: null, 'css-class': null },
    children: ['mj-section', 'mj-wrapper', 'mj-hero', 'mj-raw']
  },
  'mj-wrapper': {
    attrs: {
      'background-color': null,
      'background-url': null,
      border: null,
      'border-radius': null,
      'full-width': ['full-width'],
      ...box
    },
    children: ['mj-section', 'mj-hero', 'mj-raw']
  },
  'mj-section': {
    attrs: {
      'background-color': null,
      'background-url': null,
      border: null,
      'border-radius': null,
      direction: ['ltr', 'rtl'],
      'full-width': ['full-width'],
      'text-align': ['left', 'center', 'right'],
      ...box
    },
    children: ['mj-column', 'mj-group', 'mj-raw']
  },
  'mj-group': {
    attrs: { width: null, 'background-color': null, direction: ['ltr', 'rtl'] },
    children: ['mj-column']
  },
  'mj-column': {
    attrs: {
      width: null,
      'background-color': null,
      border: null,
      'border-radius': null,
      'vertical-align': ['top', 'middle', 'bottom'],
      ...box
    },
    children: [
      'mj-text',
      'mj-image',
      'mj-button',
      'mj-divider',
      'mj-spacer',
      'mj-social',
      'mj-table',
      'mj-navbar',
      'mj-accordion',
      'mj-carousel',
      'mj-raw'
    ]
  },
  'mj-hero': {
    attrs: {
      mode: ['fixed-height', 'fluid-height'],
      height: null,
      'background-url': null,
      'background-color': null,
      'background-width': null,
      'background-height': null,
      ...box
    },
    children: ['mj-text', 'mj-image', 'mj-button', 'mj-divider', 'mj-spacer', 'mj-social', 'mj-raw']
  },
  'mj-text': { attrs: { ...text, 'container-background-color': null, height: null, ...box } },
  'mj-image': {
    attrs: {
      src: null,
      alt: null,
      href: null,
      title: null,
      width: null,
      height: null,
      align: ['left', 'center', 'right'],
      'border-radius': null,
      'fluid-on-mobile': ['true', 'false'],
      ...box
    }
  },
  'mj-button': {
    attrs: {
      href: null,
      'background-color': null,
      color: null,
      'border-radius': null,
      'font-size': null,
      'font-weight': null,
      'inner-padding': null,
      align: ['left', 'center', 'right'],
      width: null,
      ...box
    }
  },
  'mj-divider': {
    attrs: {
      'border-color': null,
      'border-style': ['solid', 'dashed', 'dotted'],
      'border-width': null,
      width: null,
      ...box
    }
  },
  'mj-spacer': { attrs: { height: null } },
  'mj-social': {
    attrs: {
      mode: ['horizontal', 'vertical'],
      'icon-size': null,
      align: ['left', 'center', 'right'],
      ...box
    },
    children: ['mj-social-element']
  },
  'mj-social-element': {
    attrs: {
      name: ['facebook', 'x', 'instagram', 'linkedin', 'youtube', 'github', 'web'],
      href: null,
      src: null,
      'background-color': null
    }
  },
  'mj-navbar': {
    attrs: { align: ['left', 'center', 'right'], hamburger: ['hamburger'] },
    children: ['mj-navbar-link']
  },
  'mj-navbar-link': { attrs: { href: null, color: null, ...box } },
  'mj-table': { attrs: { width: null, 'table-layout': ['auto', 'fixed'], ...text, ...box } },
  'mj-raw': {}
} satisfies Record<string, TagSpec>

// Editor chrome follows the app tokens (light/dark via CSS variables).
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--ui-bg)',
    color: 'var(--ui-text)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: '12px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--ui-bg)',
    color: 'var(--ui-text-dimmed)',
    border: 'none',
    paddingRight: '4px'
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ui-text-muted)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'rgb(0 0 0 / 0.03)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ui-text-highlighted)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 22%, transparent)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ui-bg-elevated)',
    border: '1px solid var(--ui-border)',
    color: 'var(--ui-text-muted)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--ui-bg)',
    border: '1px solid var(--ui-border)',
    borderRadius: '6px',
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)'
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    maxHeight: '16em'
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--ui-bg-elevated)',
    color: 'var(--ui-text-highlighted)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--ui-bg-elevated)',
    color: 'var(--ui-text)',
    borderColor: 'var(--ui-border)'
  },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--ui-warning) 35%, transparent)'
  }
})

const extensions = [
  html({ extraTags: MJML_TAGS, autoCloseTags: true, matchClosingTags: true }),
  EditorView.lineWrapping,
  theme
]

const view = shallowRef<EditorView | null>(null)

function onReady(payload: { view: EditorView }) {
  view.value = payload.view
}

/** Inserts text at the cursor (replacing the selection) and focuses the editor. */
function insertAtCursor(snippet: string) {
  if (props.readonly) return
  const editor = view.value

  if (!editor) {
    model.value += `\n${snippet}`

    return
  }

  const { from, to } = editor.state.selection.main
  editor.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + snippet.length },
    scrollIntoView: true
  })
  editor.focus()
}

function goToLine(line: number | null) {
  const editor = view.value

  if (!editor || !line) return
  const target = editor.state.doc.line(Math.min(Math.max(line, 1), editor.state.doc.lines))
  editor.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true })
  editor.focus()
}

defineExpose({ insertAtCursor, focus: () => view.value?.focus() })

// Preview --------------------------------------------------------------------
const preview = ref<TemplatePreviewResult | null>(null)
const previewError = ref<string | null>(null)
const previewing = ref(false)
let requestId = 0

async function refreshPreview() {
  const id = ++requestId
  previewing.value = true

  try {
    const result = await $fetch<TemplatePreviewResult>('/api/templates/preview', {
      method: 'POST',
      body: { mjml: model.value, subject: props.subject ?? '', preheader: props.preheader ?? null }
    })

    if (id !== requestId) return
    preview.value = result
    previewError.value = null
    emit('issues', result.issues)
  } catch (error) {
    if (id === requestId) previewError.value = apiErrorMessage(error)
  } finally {
    if (id === requestId) previewing.value = false
  }
}

watchDebounced(() => [model.value, props.subject, props.preheader], refreshPreview, {
  debounce: 400,
  immediate: true
})

// Keep the preview scroll position across re-renders.
const frame = useTemplateRef<HTMLIFrameElement>('frame')
let scrollY = 0

watch(
  () => preview.value?.html,
  () => {
    scrollY = frame.value?.contentWindow?.scrollY ?? 0
  },
  { flush: 'pre' }
)

function onFrameLoad() {
  frame.value?.contentWindow?.scrollTo(0, scrollY)
}

const issues = computed(() => preview.value?.issues ?? [])
const showIssues = ref(true)
const pane = ref<'code' | 'preview'>('code')

const paneItems = [
  { label: 'Code', value: 'code', icon: 'i-lucide-code-xml' },
  { label: 'Preview', value: 'preview', icon: 'i-lucide-eye' }
]

const ISSUE_SOURCES = {
  mjml: { label: 'MJML', color: 'warning' },
  liquid: { label: 'Liquid', color: 'error' }
} as const satisfies Record<TemplateIssue['source'], { label: string; color: 'warning' | 'error' }>

/** Summary line of the issues bar: what is wrong (or that nothing is). */
const issuesSummary = computed(() => {
  if (previewError.value) return { title: 'Preview failed', detail: previewError.value }

  if (!issues.value.length) return { title: 'No issues', detail: 'MJML and Liquid are valid' }
  const count = issues.value.length

  return {
    title: `${count} ${count === 1 ? 'issue' : 'issues'}`,
    detail: 'Select an issue to jump to its line'
  }
})

const hasProblems = computed(() => !!previewError.value || issues.value.length > 0)
</script>

<template>
  <div class="mjml-code flex flex-col lg:flex-row h-full min-h-0">
    <div class="lg:hidden flex items-center gap-2 border-b border-default px-3 py-2">
      <UTabs
        v-model="pane"
        :items="paneItems"
        :content="false"
        size="xs"
        color="neutral"
        aria-label="Show code or preview"
        class="w-full"
      />
      <slot name="toolbar" />
    </div>

    <section
      class="flex-1 min-w-0 min-h-0 flex flex-col lg:border-e border-default"
      :class="pane === 'code' ? 'flex' : 'max-lg:hidden'"
      aria-label="MJML source"
    >
      <!-- vue-codemirror renders `display: contents`: this box sizes the editor (height 100%). -->
      <div class="flex-1 min-h-0 overflow-hidden">
        <Codemirror
          v-model="model"
          :disabled="readonly"
          :extensions="extensions"
          :indent-with-tab="true"
          :tab-size="2"
          placeholder="<mjml>…</mjml>"
          @ready="onReady"
        />
      </div>

      <UCollapsible
        :open="showIssues && issues.length > 0"
        :disabled="!issues.length"
        class="shrink-0 border-t border-default bg-default"
        @update:open="(open: boolean) => (showIssues = open)"
      >
        <UButton
          variant="ghost"
          block
          :trailing-icon="issues.length ? 'i-lucide-chevron-down' : undefined"
          class="group h-9 gap-2 rounded-none px-3 text-[13px] font-normal disabled:opacity-100 disabled:cursor-default"
          :ui="{
            trailingIcon:
              'text-muted transition-transform duration-200 group-data-[state=closed]:rotate-180'
          }"
        >
          <UIcon
            :name="hasProblems ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
            class="size-4 shrink-0"
            :class="hasProblems ? 'text-warning' : 'text-success'"
          />
          <span class="font-medium text-highlighted shrink-0">{{ issuesSummary.title }}</span>
          <span class="text-muted truncate">{{ issuesSummary.detail }}</span>
        </UButton>

        <template #content>
          <ul class="max-h-40 overflow-y-auto border-t border-default py-1" aria-label="Issues">
            <li v-for="(issue, index) in issues" :key="index">
              <UButton
                variant="ghost"
                block
                class="justify-start items-start gap-3 rounded-none px-3 py-1.5 text-[13px] font-normal text-start disabled:opacity-100 disabled:cursor-default"
                :disabled="!issue.line"
                @click="goToLine(issue.line)"
              >
                <span class="font-mono text-xs text-muted w-14 shrink-0 tabular-nums pt-px">{{
                  issue.line ? `Line ${issue.line}` : '—'
                }}</span>
                <UBadge
                  :color="ISSUE_SOURCES[issue.source].color"
                  :label="ISSUE_SOURCES[issue.source].label"
                  class="shrink-0"
                />
                <span class="text-default whitespace-normal">{{ issue.message }}</span>
              </UButton>
            </li>
          </ul>
        </template>
      </UCollapsible>
    </section>

    <section
      class="flex-1 min-w-0 min-h-0 flex-col bg-elevated/40"
      :class="pane === 'preview' ? 'flex' : 'max-lg:hidden lg:flex'"
      aria-label="Preview"
    >
      <div
        class="shrink-0 flex items-center gap-2 h-9 px-3 border-b border-default text-xs text-muted"
      >
        <span class="font-medium text-default">Preview</span>
        <span v-if="preview?.subject" class="min-w-0 truncate">· {{ preview.subject }}</span>
        <span
          class="ms-auto shrink-0 flex items-center gap-1.5 whitespace-nowrap"
          aria-live="polite"
        >
          <template v-if="previewing">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            Updating…
          </template>
          <template v-else>Sample data</template>
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden p-4 flex justify-center">
        <iframe
          v-if="preview?.html"
          ref="frame"
          :srcdoc="preview.html"
          sandbox="allow-same-origin"
          title="Email preview"
          class="h-full bg-white rounded-md ring ring-default transition-[width] duration-200"
          :style="{ width: device === 'mobile' ? '375px' : '100%' }"
          @load="onFrameLoad"
        />
        <EmptyState
          v-else-if="!previewing"
          variant="error"
          title="Nothing to preview"
          description="Fix the MJML issues to see the rendered email."
          compact
          class="self-center"
        />
        <USkeleton v-else class="h-full w-full max-w-[640px]" />
      </div>
    </section>
  </div>
</template>

<style>
/*
 * Dark mode syntax colours: CodeMirror's default highlight style is tuned for
 * light backgrounds, so the text layer is colour-inverted while keeping hues
 * (selection and cursor live in separate layers and are not affected).
 */
.dark .mjml-code .cm-content {
  color: #3f3f3f;
  filter: invert(1) hue-rotate(180deg);
}
.dark .mjml-code .cm-focused .cm-activeLine {
  background-color: rgb(0 0 0 / 0.06);
}
</style>
