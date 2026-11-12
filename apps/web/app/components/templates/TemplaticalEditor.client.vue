<script setup lang="ts">
import type { TemplaticalEditor } from '@templatical/editor'
import type { MediaRequestContext, MediaResult, TemplateContent } from '@templatical/types'
import { TemplateDesignEnvelope } from '#shared/schemas/template-design'
import type { TemplaticalEditorApi } from '#shared/schemas/template-design'
import type { TemplateDesign } from '#shared/schemas/templates'
import { EmailDesignKit } from '#shared/templates/EmailDesignKit'
import { TEMPLATE_LINT_OPTIONS } from '#shared/templates/lint'
import type { MjmlImport } from '#shared/templates/MjmlBlockImporter'
import type { TemplateKind } from '#shared/types/domain'
import type { ReadinessFix, ReadinessItem } from '~/utils/templateReadiness'

/**
 * The visual email editor (Templatical): drag-and-drop blocks, rich text with
 * variables shown as words, an image picker backed by the file manager, and a
 * pre-send check of what people most often forget. Templates saved before
 * this editor (GrapesJS, or written as MJML) are converted on open.
 */
const props = defineProps<{
  design: TemplateDesign | null
  /** Used when `design` is not an editor document: the MJML is converted into blocks. */
  mjml: string
  kind: TemplateKind
  canUpload: boolean
}>()

const emit = defineEmits<{
  ready: [api: TemplaticalEditorApi]
  /** The document was edited or saved: whether it now differs from the one opened or saved. */
  change: [edited: boolean]
  /** The editor could not open; the page keeps the stored content. */
  failed: [message: string]
}>()

/** Blocks offered in the palette, most used first (countdown needs Templatical Cloud). */
const PALETTE = [
  'section',
  'hero',
  'title',
  'paragraph',
  'button',
  'image',
  'divider',
  'spacer',
  'social',
  'menu',
  'table',
  'video',
  'html'
]

/** Colour presets in every colour picker: neutrals, then the starters' accents and tints. */
/** Toast id of the conversion notice, closed when the editor goes away. */
const CONVERTED_TOAST = 'template-converted'

/** Time for an undo, redo or keystroke to reach the document before it is compared. */
const SETTLE_MS = 50

const COLOR_PRESETS = [
  '#18181b',
  '#3f3f46',
  '#71717a',
  '#e4e4e7',
  '#f4f4f5',
  '#ffffff',
  '#4f46e5',
  '#1d4ed8',
  '#0f766e',
  '#047857',
  '#6d28d9',
  '#c2410c',
  '#be123c',
  '#eef2ff',
  '#ecfdf5',
  '#fff7ed',
  '#f5f3ff'
]

const container = useTemplateRef<HTMLDivElement>('container')
const loading = ref(true)
const failed = ref<string | null>(null)
const readiness = shallowRef<ReadinessItem[]>([])
const checksOpen = ref(false)

/**
 * Holds the "things to check" button. The editor moves it into its own top
 * bar (`header.actions`), so the check sits beside Desktop / Mobile instead of
 * taking a row of its own.
 */
const headerActions = document.createElement('div')

headerActions.className = 'templatical-actions'

const notify = useNotify()
const colorMode = useColorMode()
const images = useTemplateImages(() => props.canUpload)
const mergeTags = new TemplateMergeTags(props.kind)
const checker = new TemplateReadiness(props.kind)

let editor: TemplaticalEditor | null = null
let unmounted = false

/** The document as opened or last saved, to tell edits apart (undoing them included). */
let baseline = ''
let settleTimer: ReturnType<typeof setTimeout> | undefined

const problems = computed(() => readiness.value.filter((item) => item.level === 'problem').length)

const checksLabel = computed(() =>
  readiness.value.length === 1 ? '1 thing to check' : `${readiness.value.length} things to check`
)

/** The document to open: the saved design, or the MJML converted into blocks. */
async function initialContent(): Promise<{
  content: TemplateContent
  converted: MjmlImport | null
}> {
  const saved = TemplateDesignEnvelope.read(props.design)

  if (saved) return { content: saved, converted: null }

  const { MjmlBlockImporter } = await import('#shared/templates/MjmlBlockImporter')
  const converted = new MjmlBlockImporter().import(props.mjml)

  return { content: converted.content, converted }
}

/** The stored form of a document, as compared between edits and saves. */
function fingerprint(content: TemplateContent): string {
  return JSON.stringify(TemplateDesignEnvelope.wrap(content))
}

/** "1 part", "3 parts". */
function parts(count: number): string {
  return count === 1 ? '1 part' : `${count} parts`
}

/** Says the email was rebuilt as blocks, and which parts did not become editable blocks. */
function notifyConverted({ keptAsHtml, dropped, unsupportedLogic }: MjmlImport) {
  const details = [
    keptAsHtml ? `${parts(keptAsHtml)} kept as HTML blocks.` : '',
    dropped ? `${parts(dropped)} could not be converted.` : '',
    unsupportedLogic
      ? `${unsupportedLogic === 1 ? '1 Liquid tag' : `${unsupportedLogic} Liquid tags`} around whole parts could not be kept: those parts would show for every contact, or break the layout.`
      : ''
  ]

  const options = {
    id: CONVERTED_TOAST,
    description:
      `${details.filter(Boolean).join(' ')} Spacing and styles can differ a little: check it with Preview before saving.`.trim(),
    duration: 0
  }

  if (unsupportedLogic || dropped) {
    notify.warning('This email was converted into blocks', options)
  } else {
    notify.info('This email was converted into blocks', options)
  }
}

async function requestMedia(context?: MediaRequestContext): Promise<MediaResult | null> {
  const url = context?.files?.length ? (await images.upload(context.files))[0] : await images.pick()

  if (!url) return null

  const size = await imageSize(url)

  return size ? { url, ...size } : { url }
}

/** Re-runs the checks and tells the page whether the document has unsaved edits. */
function refresh(content?: TemplateContent) {
  const current = content ?? editor?.getContent()

  if (!current) return

  readiness.value = checker.check(current)
  emit('change', fingerprint(current) !== baseline)
}

/**
 * The editor reports no change for undo and redo, and reports others after a
 * delay: the document is compared after every keystroke and click as well.
 */
function settle() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => refresh(), SETTLE_MS)
}

useEventListener(container, 'keyup', settle)

useEventListener(container, 'pointerup', settle)

const FIXES = new Map<ReadinessFix, { label: string; done: string; icon: string }>([
  ['add-footer', { label: 'Add footer', done: 'Footer added', icon: 'i-lucide-panel-bottom' }],
  [
    'add-unsubscribe-link',
    { label: 'Add unsubscribe link', done: 'Unsubscribe link added', icon: 'i-lucide-link' }
  ]
])

/**
 * Inserts the fix through the editor, like a block from the palette, so it can
 * be undone. With nothing selected it lands at the bottom of the email.
 */
function fix(item: ReadinessItem) {
  const action = item.fix ? FIXES.get(item.fix) : undefined

  if (!editor || !item.fix || !action) return

  const kit = EmailDesignKit.matching(editor.getContent().settings)
  const block = item.fix === 'add-footer' ? kit.footer(props.kind) : kit.unsubscribeLine()
  const id = editor.insertBlock(block)

  checksOpen.value = false

  if (!id) {
    notify.error('Could not add it', undefined, {
      description: 'Switch off Preview, then try again.'
    })

    return
  }

  const content = editor.getContent()

  refresh(content)

  if (content.blocks.at(-1)?.id === id) {
    notify.success(action.done, {
      description: 'It is at the bottom of the email. Undo removes it.'
    })
  } else {
    notify.warning(`${action.done} below the selected block`, {
      description: 'Drag it to the bottom of the email, where people look for it.',
      duration: 0
    })
  }
}

async function mount(el: HTMLDivElement) {
  const [{ init }, { content, converted }] = await Promise.all([
    import('@templatical/editor'),
    initialContent()
  ])

  if (unmounted) return

  const instance = await init({
    container: el,
    content,
    locale: 'en',
    branding: false,
    uiTheme: colorMode.value === 'dark' ? 'dark' : 'light',
    changeDebounce: 300,
    mergeTags: { syntax: 'liquid', tags: mergeTags.for(content) },
    onRequestMedia: requestMedia,
    paletteBlocks: PALETTE,
    htmlBlockPreview: true,
    colors: { presets: COLOR_PRESETS },
    blockDefaults: {
      button: {
        backgroundColor: '#18181b',
        textColor: '#ffffff',
        borderRadius: 8,
        fontWeight: 'bold'
      }
    },
    // The preheader is edited in the page toolbar, for both editors.
    templateSettings: {
      fields: [
        'width',
        'backgroundColor',
        'textColor',
        'linkColor',
        'linkUnderline',
        'fontFamily',
        'locale',
        'direction'
      ]
    },
    lint: TEMPLATE_LINT_OPTIONS,
    header: { actions: headerActions },
    onChange: (next) => refresh(next),
    onError: (error) => {
      if (!unmounted) notify.error('The editor ran into a problem', error)
    }
  })

  if (unmounted) {
    instance.unmount()

    return
  }

  editor = instance
  baseline = fingerprint(instance.getContent())
  readiness.value = checker.check(instance.getContent())
  loading.value = false

  if (converted) notifyConverted(converted)

  emit('ready', {
    getContent: async () => {
      if (!editor) return null
      const document = editor.getContent()

      return { mjml: await editor.toMjml(), design: TemplateDesignEnvelope.wrap(document) }
    },
    isChanged: () => (editor ? fingerprint(editor.getContent()) !== baseline : false),
    markSaved: (design) => {
      baseline = JSON.stringify(design)
      refresh()
    }
  })
}

onMounted(async () => {
  // A .client component renders its template one tick after it mounts.
  await nextTick()
  const el = container.value

  if (!el) return

  try {
    await mount(el)
  } catch (error) {
    if (unmounted) return
    notify.dismiss(CONVERTED_TOAST)
    loading.value = false
    failed.value = error instanceof Error ? error.message : String(error)
    emit('failed', failed.value)
  }
})

watch(
  () => colorMode.value,
  (mode) => editor?.setTheme(mode === 'dark' ? 'dark' : 'light')
)

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(settleTimer)
  notify.dismiss(CONVERTED_TOAST)
  editor?.unmount()
  editor = null
})
</script>

<template>
  <div class="flex flex-col min-h-0 min-w-0">
    <Teleport :to="headerActions">
      <UPopover v-if="readiness.length" v-model:open="checksOpen">
        <UButton
          size="xs"
          variant="soft"
          :color="problems ? 'warning' : 'neutral'"
          :icon="problems ? 'i-lucide-triangle-alert' : 'i-lucide-lightbulb'"
          :aria-label="checksLabel"
          trailing-icon="i-lucide-chevron-down"
        >
          <span class="templatical-actions-count">{{ readiness.length }}</span>
          <span class="templatical-actions-label">{{ checksLabel }}</span>
        </UButton>
        <template #content>
          <ul class="w-80 divide-y divide-default" aria-label="Before you send">
            <li v-for="item in readiness" :key="item.id" class="p-3 space-y-1.5">
              <p class="flex items-start gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  :name="item.level === 'problem' ? 'i-lucide-circle-alert' : 'i-lucide-lightbulb'"
                  class="size-4 shrink-0 mt-0.5"
                  :class="item.level === 'problem' ? 'text-warning' : 'text-muted'"
                />
                {{ item.title }}
              </p>
              <p class="text-xs text-muted ps-6">{{ item.description }}</p>
              <div v-if="item.fix" class="ps-6 pt-1">
                <UButton
                  size="xs"
                  :icon="FIXES.get(item.fix)?.icon"
                  :label="FIXES.get(item.fix)?.label"
                  @click="fix(item)"
                />
              </div>
            </li>
          </ul>
        </template>
      </UPopover>
    </Teleport>

    <div class="relative flex-1 min-h-0">
      <div ref="container" class="templatical-host absolute inset-0" />

      <div
        v-if="loading"
        class="absolute inset-0 grid place-items-center bg-default"
        role="status"
        aria-live="polite"
      >
        <span class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          Opening the editor…
        </span>
      </div>

      <div v-else-if="failed" class="absolute inset-0 grid place-items-center p-6 bg-default">
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          title="The editor could not open this template"
          :description="`${failed} Switch to Code to edit the MJML directly.`"
          class="max-w-md"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The editor lives in a shadow root; these tokens carry the app's theme across it. */
.templatical-host {
  --tpl-user-font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  --tpl-user-primary: var(--ui-primary);
  --tpl-user-primary-hover: color-mix(in oklab, var(--ui-primary) 85%, black);
  --tpl-user-primary-light: color-mix(in oklab, var(--ui-primary) 12%, var(--ui-bg));
  --tpl-user-bg: var(--ui-bg);
  --tpl-user-bg-elevated: var(--ui-bg-elevated);
  --tpl-user-border: var(--ui-border);
  --tpl-user-border-light: var(--ui-border-muted);
  --tpl-user-text: var(--ui-text);
  --tpl-user-text-muted: var(--ui-text-muted);
  --tpl-user-text-dim: var(--ui-text-dimmed);
  --tpl-user-canvas-bg: var(--ui-bg-muted);
  --tpl-user-dark-primary: var(--ui-primary);
  --tpl-user-dark-primary-hover: color-mix(in oklab, var(--ui-primary) 85%, white);
  --tpl-user-dark-primary-light: color-mix(in oklab, var(--ui-primary) 18%, var(--ui-bg));
  --tpl-user-dark-bg: var(--ui-bg);
  --tpl-user-dark-bg-elevated: var(--ui-bg-elevated);
  --tpl-user-dark-border: var(--ui-border);
  --tpl-user-dark-border-light: var(--ui-border-muted);
  --tpl-user-dark-text: var(--ui-text);
  --tpl-user-dark-text-muted: var(--ui-text-muted);
  --tpl-user-dark-text-dim: var(--ui-text-dimmed);
  --tpl-user-dark-canvas-bg: var(--ui-bg-muted);
}
</style>

<style>
/* The editor collapses its top bar when space runs out: the check then shows only its count. */
.templatical-actions-count {
  display: none;
}

.templatical-actions[data-tpl-compact='true'] .templatical-actions-count {
  display: inline;
}

.templatical-actions[data-tpl-compact='true'] .templatical-actions-label {
  display: none;
}
</style>
