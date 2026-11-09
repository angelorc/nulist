<script setup lang="ts">
import { grapesjs, usePlugin } from 'grapesjs'
import type {
  AssetsCustomData,
  CanvasDragDataResult,
  Component,
  ComponentView,
  Editor,
  UploadFileFn
} from 'grapesjs'
import grapesjsMjml from 'grapesjs-mjml'
import 'grapesjs/dist/css/grapes.min.css'
import type { VNode } from 'vue'
import { z } from 'zod'
import { TemplatesImagePickerModal } from '#components'
import type { FileUploadResult } from '#shared/schemas/files'
import { templateDesignSchema } from '#shared/schemas/templates'
import type {
  TemplateDesign,
  VisualEditorApi,
  VisualEditorContent
} from '#shared/schemas/templates'

/**
 * Drag & drop MJML editor (GrapesJS + grapesjs-mjml) rendered inside the app
 * chrome: blocks/layers on the left, canvas in the middle, style/settings and
 * the page's own panel (slot) on the right. Images go through the file manager.
 * GrapesJS has no read-only mode: pages mount it only for `template:update`.
 * `canUpload` (`file:create`) gates canvas drops, pastes and asset uploads.
 */
const props = defineProps<{
  mjml: string
  design?: TemplateDesign | null
  device: 'desktop' | 'mobile'
  canUpload?: boolean
}>()

const emit = defineEmits<{ change: []; ready: [api: VisualEditorApi]; save: [] }>()

defineSlots<{ panel?: () => VNode[] }>()

const DEVICES = {
  desktop: { id: 'desktop', name: 'Desktop', width: '' },
  mobile: { id: 'mobile', name: 'Mobile', width: '375px', widthMedia: '480px' }
} as const

const LAYOUT_BLOCKS = new Set([
  'mj-1-column',
  'mj-2-columns',
  'mj-3-columns',
  'mj-hero',
  'mj-wrapper'
])

const PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" fill="#f5f5f5"/><g fill="none" stroke="#a3a3a3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(276 126)"><rect x="3" y="3" width="42" height="42" rx="4"/><circle cx="17" cy="17" r="4"/><path d="m45 31-9-9L9 45"/></g></svg>')}`

/** Block overrides: neutral placeholder copy instead of the plugin's demo content. */
const BLOCK_CONTENT = new Map(
  Object.entries({
    'mj-1-column':
      '<mj-section><mj-column><mj-text>Write something worth reading.</mj-text></mj-column></mj-section>',
    'mj-2-columns':
      '<mj-section><mj-column><mj-text>First column</mj-text></mj-column><mj-column><mj-text>Second column</mj-text></mj-column></mj-section>',
    'mj-3-columns':
      '<mj-section><mj-column><mj-text>One</mj-text></mj-column><mj-column><mj-text>Two</mj-text></mj-column><mj-column><mj-text>Three</mj-text></mj-column></mj-section>',
    'mj-button': '<mj-button href="https://example.com">Call to action</mj-button>',
    'mj-hero': `<mj-hero mode="fluid-height" background-color="#171717" padding="56px 24px">
    <mj-text align="center" color="#ffffff" font-size="28px" line-height="36px" font-weight="600">Big announcement</mj-text>
    <mj-text align="center" color="#d4d4d4">One short sentence that explains why it matters.</mj-text>
    <mj-button align="center" background-color="#ffffff" color="#171717" href="https://example.com">Learn more</mj-button>
  </mj-hero>`,
    'mj-wrapper':
      '<mj-wrapper padding="16px" background-color="#ffffff" border-radius="8px"><mj-section><mj-column><mj-text>Grouped content</mj-text></mj-column></mj-section></mj-wrapper>'
  })
)

const CANVAS_CSS = `
  [data-gjs-type="mj-head"], mj-head { display: none !important; }
  body { margin: 0; }
  ::selection { background: rgba(37, 99, 235, .2); }
`

const canvasEl = useTemplateRef<HTMLElement>('canvas')
const blocksEl = useTemplateRef<HTMLElement>('blocks')
const layersEl = useTemplateRef<HTMLElement>('layers')
const stylesEl = useTemplateRef<HTMLElement>('styles')
const traitsEl = useTemplateRef<HTMLElement>('traits')

const loading = ref(true)
const uploading = ref(0)
const leftTab = ref<'blocks' | 'layers'>('blocks')
const rightTab = ref<'style' | 'settings' | 'content'>('content')
const leftOpen = ref(false)
const rightOpen = ref(false)
const selection = shallowRef<{ name: string; isImage: boolean } | null>(null)
const canUndo = ref(false)
const canRedo = ref(false)
const outlines = ref(true)

const notify = useNotify()
const overlay = useOverlay()

const LEFT_TABS = [
  { label: 'Blocks', value: 'blocks', icon: 'i-lucide-blocks' },
  { label: 'Layers', value: 'layers', icon: 'i-lucide-layers' }
]

const RIGHT_TABS = [
  { label: 'Style', value: 'style' },
  { label: 'Settings', value: 'settings' },
  { label: 'Content', value: 'content' }
]

const picker = overlay.create(TemplatesImagePickerModal)

let editor: Editor | null = null
let headMjml: string | null = null

/** Programmatic selections (after inserting an image) keep the current side tab. */
let keepTab = false

/** GrapesJS parses MJML with the HTML parser: expand self-closing tags first. */
function toEditorMarkup(source: string): string {
  return source.replace(/<(mj-[a-z0-9-]+)((?:\s[^<>]*?)?)\s*\/>/gi, '<$1$2></$1>')
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Uploads ------------------------------------------------------------------
function denyUpload() {
  notify.error("You don't have permission to upload files", undefined, {
    description: 'Pick an existing image from the file manager instead.',
    icon: 'i-lucide-lock'
  })
}

async function uploadImages(files: File[]): Promise<string[]> {
  const images = files.filter((file) => file.type.startsWith('image/'))

  if (!images.length) return []

  if (!props.canUpload) {
    denyUpload()

    return []
  }

  const form = new FormData()

  for (const file of images) form.append('file', file, file.name || 'pasted-image.png')
  uploading.value++

  try {
    const result = await $fetch<FileUploadResult>('/api/files', { method: 'POST', body: form })

    for (const failure of result.errors) {
      notify.error(`Couldn't upload ${failure.name}`, undefined, { description: failure.message })
    }

    const urls = result.items.map((item) => item.url)
    editor?.AssetManager.add(urls.map((src) => ({ src, type: 'image' })))

    if (urls.length)
      notify.success(urls.length === 1 ? 'Image uploaded' : `${urls.length} images uploaded`)

    return urls
  } catch (error) {
    notify.error('Upload failed', error)

    return []
  } finally {
    uploading.value--
  }
}

/**
 * Asset manager upload hook. GrapesJS calls it for files dropped on the canvas
 * (as mj-image) with `{ dataTransfer: { files } }` and the file in `options`.
 */
const uploadFile: UploadFileFn = (event, done, options) => {
  const files = options?.file ? [options.file] : Array.from(event.dataTransfer?.files ?? [])

  return (async () => {
    const urls = await uploadImages(files)

    if (urls.length) done?.({ data: urls })
  })()
}

/** The image a component shows, unless it is the inline placeholder. */
function currentImageSrc(target: Component | undefined): string | null {
  const src = z.string().safeParse(target?.get('src'))

  return src.success && !src.data.startsWith('data:') ? src.data : null
}

/** Replaces GrapesJS's asset modal with the app's image picker. */
async function openAssets(data: AssetsCustomData) {
  const current = currentImageSrc(data.options?.target)
  const url = await picker.open({ current }).result

  if (url) data.select(data.am.add({ src: url, type: 'image' }), true)
  data.close()
}

// Public API -----------------------------------------------------------------
function getContent(): VisualEditorContent | null {
  if (!editor) return null

  // Round-trip through JSON (drops undefined fields), then check it is a JSON object.
  return {
    mjml: editor.getHtml().trim(),
    design: templateDesignSchema.parse(JSON.parse(JSON.stringify(editor.getProjectData())))
  }
}

/** Inserts an image next to the selection (or replaces the selected image). */
function insertImage(url: string, alt = '') {
  if (!editor) return
  const selected = editor.getSelected()

  if (selected?.is('mj-image')) {
    selected.set('src', url)

    if (alt) selected.addAttributes({ alt })

    return
  }

  const markup = `<mj-image src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"></mj-image>`
  let added: Component[] | Component | undefined
  const parent = selected?.parent()

  if (selected && (selected.is('mj-column') || selected.is('mj-hero'))) {
    added = selected.append(markup)
  } else if (selected && parent && (parent.is('mj-column') || parent.is('mj-hero'))) {
    added = parent.components().add(markup, { at: selected.index() + 1 })
  } else if (selected?.is('mj-section')) {
    const column = selected.findType('mj-column')[0]
    added = column ? column.append(markup) : selected.append(`<mj-column>${markup}</mj-column>`)
  } else {
    const body = editor.getWrapper()?.findType('mj-body')[0]
    added = body?.append(`<mj-section><mj-column>${markup}</mj-column></mj-section>`)
  }

  const first = Array.isArray(added) ? added[0] : added

  if (first) {
    const image = first.is('mj-image') ? first : first.findType('mj-image')[0]

    if (image) {
      keepTab = true
      editor.select(image)
      keepTab = false
    }
  }
}

function replaceSelectedImage() {
  const selected = editor?.getSelected()

  if (selected?.is('mj-image')) selected.trigger('active')
}

function undo() {
  editor?.UndoManager.undo()
}

function redo() {
  editor?.UndoManager.redo()
}

function toggleOutlines() {
  if (!editor) return
  const command = 'core:component-outline'

  if (editor.Commands.isActive(command)) editor.stopCommand(command)
  else editor.runCommand(command)
  outlines.value = editor.Commands.isActive(command)
}

defineExpose({ getContent, insertImage })

/** grapesjs-mjml `block` option: the category, plus neutral content where we override it. */
interface MjmlBlockOverrides {
  category: 'Layout' | 'Content'
  content?: string
}

function blockOverrides(id: string): MjmlBlockOverrides {
  const block: MjmlBlockOverrides = { category: LAYOUT_BLOCKS.has(id) ? 'Layout' : 'Content' }
  const content = BLOCK_CONTENT.get(id)

  if (content) block.content = content

  return block
}

// Lifecycle ----------------------------------------------------------------

interface MjmlTemplate {
  start: string
  end: string
}

type MjmlAttributes = z.infer<typeof mjmlAttributesSchema>

const mjmlAttributesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))

/** Method grapesjs-mjml adds to its component views (absent from the GrapesJS types). */
interface MjmlViewPrototype {
  getMjmlTemplate(this: ComponentView): MjmlTemplate
}

/** Method grapesjs-mjml adds to its component models (absent from the GrapesJS types). */
interface MjmlModelPrototype {
  getMjmlAttributes(this: Component): MjmlAttributes
}

/** A grapesjs-mjml view prototype: the plugin defines `getMjmlTemplate` on every mj-* view. */
function isMjmlView(proto: ComponentView): proto is ComponentView & MjmlViewPrototype {
  return 'getMjmlTemplate' in proto
}

/** A grapesjs-mjml model prototype: the plugin defines `getMjmlAttributes` on every mj-* model. */
function isMjmlModel(proto: Component): proto is Component & MjmlModelPrototype {
  return 'getMjmlAttributes' in proto
}

type MjmlTemplateFn = MjmlViewPrototype['getMjmlTemplate']

type MjmlAttributesFn = MjmlModelPrototype['getMjmlAttributes']

/**
 * Methods installed by this patch. Component types are shared by every editor
 * instance and child types inherit their parent's method, so the check is on the
 * method (not the prototype) to never wrap a patched method twice.
 */
const patchedMethods = new WeakSet<MjmlTemplateFn | MjmlAttributesFn>()

/**
 * grapesjs-mjml renders each component in isolation and passes every default
 * value as an explicit attribute, so `<mj-attributes>` from the head never
 * reach the canvas. Inject the document head into each per-component compile
 * and drop attributes that only repeat the component defaults (the export
 * drops them too), keeping the canvas faithful to the sent email.
 */
function applyHeadToCanvas(instance: Editor) {
  const getHead = () => {
    if (headMjml === null) headMjml = instance.getWrapper()?.findType('mj-head')[0]?.toHTML() ?? ''

    return headMjml
  }

  for (const type of instance.Components.getTypes()) {
    if (!type.id.startsWith('mj-')) continue

    const viewProto: ComponentView = type.view.prototype

    if (isMjmlView(viewProto) && !patchedMethods.has(viewProto.getMjmlTemplate)) {
      const template = viewProto.getMjmlTemplate

      const patched: MjmlTemplateFn = function (this: ComponentView) {
        const result = template.call(this)
        const head = getHead()

        return head && result.start.startsWith('<mjml>')
          ? { start: result.start.replace('<mjml>', `<mjml>${head}`), end: result.end }
          : result
      }

      patchedMethods.add(patched)
      viewProto.getMjmlTemplate = patched
    }

    const modelProto: Component = type.model.prototype

    if (isMjmlModel(modelProto) && !patchedMethods.has(modelProto.getMjmlAttributes)) {
      const attributes = modelProto.getMjmlAttributes

      const patched: MjmlAttributesFn = function (this: Component) {
        const result = { ...attributes.call(this) }
        const parsed = mjmlAttributesSchema.safeParse(this.get('style-default'))
        const defaults = new Map(parsed.success ? Object.entries(parsed.data) : [])

        for (const key of Object.keys(result)) {
          if (defaults.has(key) && result[key] === defaults.get(key)) delete result[key]
        }

        return result
      }

      patchedMethods.add(patched)
      modelProto.getMjmlAttributes = patched
    }
  }
}

function syncHistory() {
  if (!editor) return
  canUndo.value = editor.UndoManager.hasUndo()
  canRedo.value = editor.UndoManager.hasRedo()
}

function onCanvasPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith('image/')
  )

  if (!files.length) return
  event.preventDefault()
  event.stopPropagation()
  void uploadImages(files).then((urls) => {
    for (const url of urls) insertImage(url)

    return urls
  })
}

onMounted(async () => {
  // .client components render their template after the first mount tick.
  await nextTick()

  if (
    editor ||
    !canvasEl.value ||
    !blocksEl.value ||
    !layersEl.value ||
    !stylesEl.value ||
    !traitsEl.value
  )
    return

  // Saved project data restores the exact editor state; otherwise the MJML is parsed.
  const source =
    props.design && Object.keys(props.design).length > 0
      ? { projectData: props.design }
      : { components: toEditorMarkup(props.mjml) }

  const instance = grapesjs.init({
    container: canvasEl.value,
    height: '100%',
    width: 'auto',
    fromElement: false,
    telemetry: false,
    noticeOnUnload: false,
    storageManager: false,
    showOffsets: true,
    panels: { defaults: [] },
    canvasCss: CANVAS_CSS,
    deviceManager: { default: props.device, devices: [DEVICES.desktop, DEVICES.mobile] },
    blockManager: { appendTo: blocksEl.value },
    layerManager: { appendTo: layersEl.value },
    styleManager: { appendTo: stylesEl.value },
    traitManager: { appendTo: traitsEl.value },
    assetManager: {
      custom: { open: (data: AssetsCustomData) => void openAssets(data), close: () => undefined },
      uploadFile,
      autoAdd: true,
      assets: []
    },
    ...source,
    plugins: [
      usePlugin(grapesjsMjml, {
        useCustomTheme: false,
        resetDevices: false,
        imagePlaceholderSrc: PLACEHOLDER_IMAGE,
        columnsPadding: '0px',
        blocks: [
          'mj-1-column',
          'mj-2-columns',
          'mj-3-columns',
          'mj-hero',
          'mj-wrapper',
          'mj-text',
          'mj-button',
          'mj-image',
          'mj-divider',
          'mj-spacer',
          'mj-social-group',
          'mj-navbar'
        ],
        block: (id: string) => blockOverrides(id)
      }),
      (ed: Editor) => applyHeadToCanvas(ed)
    ]
  })

  editor = instance

  // Files dropped on the canvas become mj-image components, uploaded through uploadFile.
  instance.on(
    'canvas:dragdata',
    (dataTransfer: DataTransfer | null | undefined, result: CanvasDragDataResult) => {
      const files = Array.from(dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith('image/')
      )

      if (!files.length) return

      if (!props.canUpload) {
        result.setContent([])
        denyUpload()

        return
      }

      result.setContent(
        files.map((file) => ({
          type: 'mj-image',
          file,
          attributes: { alt: file.name.replace(/\.[^.]+$/, '') }
        }))
      )
    }
  )

  instance.on('canvas:frame:load', ({ window }: { window: Window }) => {
    window.document.addEventListener('paste', onCanvasPaste, true)
  })

  instance.on('component:selected component:deselected component:toggled', () => {
    const selected = instance.getSelected()
    selection.value = selected
      ? { name: selected.getName(), isImage: selected.is('mj-image') }
      : null

    if (selected && !keepTab && rightTab.value === 'content') rightTab.value = 'style'
  })

  instance.Keymaps.add('mlist:save', '⌘+s, ctrl+s', () => emit('save'), { prevent: true })

  instance.on('load', () => {
    headMjml = null
    loading.value = false
    outlines.value = instance.Commands.isActive('core:component-outline')
    syncHistory()
    instance.on('update', () => {
      syncHistory()
      emit('change')
    })
    instance.on('undo redo', syncHistory)
    emit('ready', { getContent, insertImage })
  })
})

watch(
  () => props.device,
  (device) => {
    editor?.setDevice(device)
  }
)

onBeforeUnmount(() => {
  editor?.destroy()
  editor = null
})
</script>

<template>
  <div class="mlist-gjs relative flex h-full min-h-0">
    <!-- Left rail: blocks & layers (a drawer below xl; GrapesJS renders into these nodes). -->
    <aside
      id="gjs-left-rail"
      class="w-60 shrink-0 flex-col border-e border-default bg-default max-xl:absolute max-xl:inset-y-0 max-xl:start-0 max-xl:z-30 max-xl:shadow-lg"
      :class="leftOpen ? 'flex' : 'max-xl:hidden xl:flex'"
      aria-label="Blocks and layers"
      @keydown.esc="leftOpen = false"
    >
      <div class="shrink-0 flex items-center gap-1 px-2 h-11 border-b border-default">
        <UTabs
          v-model="leftTab"
          :items="LEFT_TABS"
          :content="false"
          size="xs"
          color="neutral"
          aria-label="Blocks or layers"
          class="flex-1"
        />
        <UButton
          class="xl:hidden"
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          aria-label="Close blocks and layers"
          @click="leftOpen = false"
        />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <p v-show="leftTab === 'blocks'" class="px-3 pt-3 text-xs text-muted">
          Drag blocks onto the canvas. Drop image files to upload them.
        </p>
        <div v-show="leftTab === 'blocks'" ref="blocks" />
        <div v-show="leftTab === 'layers'" ref="layers" class="py-1" />
      </div>
    </aside>

    <!-- Canvas -->
    <div class="relative flex-1 min-w-0 flex flex-col bg-muted">
      <div class="shrink-0 flex items-center gap-1 h-11 px-2 border-b border-default bg-default">
        <UTooltip text="Blocks and layers">
          <UButton
            class="xl:hidden"
            icon="i-lucide-panel-left"
            size="sm"
            variant="ghost"
            aria-label="Show blocks and layers"
            aria-controls="gjs-left-rail"
            :aria-expanded="leftOpen"
            @click="leftOpen = !leftOpen"
          />
        </UTooltip>
        <UTooltip text="Undo" :kbds="['meta', 'z']">
          <UButton
            icon="i-lucide-undo-2"
            size="sm"
            variant="ghost"
            :disabled="!canUndo"
            aria-label="Undo"
            @click="undo"
          />
        </UTooltip>
        <UTooltip text="Redo" :kbds="['meta', 'shift', 'z']">
          <UButton
            icon="i-lucide-redo-2"
            size="sm"
            variant="ghost"
            :disabled="!canRedo"
            aria-label="Redo"
            @click="redo"
          />
        </UTooltip>
        <USeparator orientation="vertical" class="h-5 mx-1" />
        <UTooltip text="Show component outlines">
          <UButton
            icon="i-lucide-square-dashed"
            size="sm"
            :variant="outlines ? 'soft' : 'ghost'"
            :aria-pressed="outlines"
            aria-label="Toggle component outlines"
            @click="toggleOutlines"
          />
        </UTooltip>
        <span v-if="selection" class="ms-2 min-w-0 text-xs text-muted truncate">
          Selected: <span class="text-default font-medium">{{ selection.name }}</span>
        </span>
        <span
          v-if="uploading"
          class="ms-auto shrink-0 flex items-center gap-1.5 text-xs text-muted"
          aria-live="polite"
        >
          <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" /> Uploading…
        </span>
        <UTooltip text="Style and settings">
          <UButton
            class="lg:hidden"
            :class="!uploading && 'ms-auto'"
            icon="i-lucide-panel-right"
            size="sm"
            variant="ghost"
            aria-label="Show style and settings"
            aria-controls="gjs-right-rail"
            :aria-expanded="rightOpen"
            @click="rightOpen = !rightOpen"
          />
        </UTooltip>
      </div>
      <div class="relative flex-1 min-h-0">
        <div ref="canvas" class="absolute inset-0" />
        <div
          v-if="loading"
          class="absolute inset-0 z-10 flex justify-center bg-muted p-6"
          aria-busy="true"
          aria-label="Loading the editor"
        >
          <div class="w-full max-w-[600px] space-y-3">
            <USkeleton class="h-6 w-1/3" />
            <USkeleton class="h-56 w-full" />
            <USkeleton class="h-4 w-full" />
            <USkeleton class="h-4 w-5/6" />
            <USkeleton class="h-9 w-32" />
          </div>
        </div>
      </div>
    </div>

    <!-- Right rail: style, settings, content panel (a drawer below lg). -->
    <aside
      id="gjs-right-rail"
      class="w-72 shrink-0 flex-col border-s border-default bg-default max-lg:absolute max-lg:inset-y-0 max-lg:end-0 max-lg:z-30 max-lg:shadow-lg"
      :class="rightOpen ? 'flex' : 'max-lg:hidden lg:flex'"
      aria-label="Component settings"
      @keydown.esc="rightOpen = false"
    >
      <div class="shrink-0 flex items-center gap-1 px-2 h-11 border-b border-default">
        <UTabs
          v-model="rightTab"
          :items="RIGHT_TABS"
          :content="false"
          size="xs"
          color="neutral"
          aria-label="Component panel"
          class="flex-1"
        />
        <UButton
          class="lg:hidden"
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          aria-label="Close style and settings"
          @click="rightOpen = false"
        />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <EmptyState
          v-show="rightTab !== 'content' && !selection"
          icon="i-lucide-mouse-pointer-click"
          title="Nothing selected"
          description="Click an element on the canvas to edit it."
          compact
          class="px-4"
        />
        <div v-show="rightTab === 'style' && selection" ref="styles" />
        <div v-show="rightTab === 'settings' && selection">
          <div v-if="selection?.isImage" class="px-3 pt-3">
            <UButton
              label="Replace image"
              icon="i-lucide-image"
              variant="outline"
              size="sm"
              block
              @click="replaceSelectedImage"
            />
          </div>
          <div ref="traits" />
        </div>
        <div v-show="rightTab === 'content'">
          <slot name="panel" />
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
/* GrapesJS themed with the app tokens (DESIGN.md): hairlines, neutral surfaces, blue accent. */
.mlist-gjs {
  --gjs-main-color: var(--ui-bg);
  --gjs-primary-color: var(--ui-bg);
  --gjs-secondary-color: var(--ui-text);
  --gjs-tertiary-color: var(--ui-primary);
  --gjs-quaternary-color: var(--ui-primary);
  --gjs-font-color: var(--ui-text);
  --gjs-font-color-active: var(--ui-text-highlighted);
  --gjs-main-dark-color: var(--ui-bg-elevated);
  --gjs-secondary-dark-color: transparent;
  --gjs-main-light-color: var(--ui-bg-elevated);
  --gjs-secondary-light-color: var(--ui-text-muted);
  --gjs-soft-light-color: transparent;
  --gjs-light-border: var(--ui-border);
  --gjs-arrow-color: var(--ui-text-muted);
  --gjs-dark-text-shadow: var(--ui-border);
  --gjs-color-blue: var(--ui-primary);
  --gjs-color-highlight: var(--ui-primary);
  --gjs-placeholder-background-color: var(--ui-primary);
  --gjs-main-font: var(--font-sans);
  --gjs-font-size: 12px;
  --gjs-canvas-top: 0px;
  --gjs-left-width: 0px;
  --gjs-input-padding: 6px;
  --gjs-color-input-padding: 26px;
}

.mlist-gjs .gjs-editor {
  font-family: var(--font-sans);
  background: transparent;
  color: var(--ui-text);
}
.mlist-gjs .gjs-one-bg {
  background-color: var(--ui-bg);
}
.mlist-gjs .gjs-two-color {
  color: var(--ui-text);
}
.mlist-gjs .gjs-four-color,
.mlist-gjs .gjs-four-color-h:hover {
  color: var(--ui-primary);
}
.mlist-gjs .gjs-cv-canvas {
  width: 100%;
  height: 100%;
  top: 0;
  background: var(--ui-bg-muted);
}
.mlist-gjs .gjs-frame-wrapper {
  padding: 0;
}
.mlist-gjs .gjs-frame {
  background: #fff;
}

/* Canvas tools */
.mlist-gjs .gjs-badge {
  background: var(--ui-primary);
  color: var(--ui-bg);
  border-radius: 4px;
  font: 500 11px/16px var(--font-sans);
  padding: 1px 6px;
  box-shadow: none;
}
.mlist-gjs .gjs-toolbar {
  background: var(--ui-primary);
  border-radius: 4px;
  overflow: hidden;
}
.mlist-gjs .gjs-toolbar-item {
  width: 24px;
  padding: 4px;
}
.mlist-gjs .gjs-toolbar-item:hover {
  background: rgb(0 0 0 / 0.15);
}
.mlist-gjs .gjs-resizer-h {
  border-color: var(--ui-primary);
  border-width: 2px;
}
.mlist-gjs .gjs-placeholder-int {
  box-shadow: none;
}

/* Rich text toolbar */
.mlist-gjs .gjs-rte-toolbar {
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  overflow: hidden;
}
.mlist-gjs .gjs-rte-actionbar {
  display: flex;
}
.mlist-gjs .gjs-rte-action {
  color: var(--ui-text);
  border-right: 1px solid var(--ui-border);
  min-width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 13px;
  padding: 0 6px;
}
.mlist-gjs .gjs-rte-action:last-child {
  border-right: 0;
}
.mlist-gjs .gjs-rte-action:hover,
.mlist-gjs .gjs-rte-active {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

/* Blocks */
.mlist-gjs .gjs-block-categories {
  display: flex;
  flex-direction: column;
}
.mlist-gjs .gjs-block-category {
  border-bottom: 1px solid var(--ui-border);
}
.mlist-gjs .gjs-block-category.gjs-open {
  border-bottom: 1px solid var(--ui-border);
}
.mlist-gjs .gjs-block-category .gjs-title,
.mlist-gjs .gjs-sm-sector-title,
.mlist-gjs .gjs-trait-category .gjs-title {
  background: transparent;
  border: 0;
  letter-spacing: 0;
  font: 500 12px/16px var(--font-sans);
  color: var(--ui-text-highlighted);
  padding: 12px 12px 8px;
}
.mlist-gjs .gjs-caret-icon,
.mlist-gjs .gjs-sm-sector-caret {
  color: var(--ui-text-muted);
}
.mlist-gjs .gjs-blocks-c {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 0 12px 12px;
}
.mlist-gjs .gjs-block {
  width: auto;
  min-height: 76px;
  margin: 0;
  padding: 12px 6px 10px;
  gap: 8px;
  justify-content: center;
  align-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  box-shadow: none;
  cursor: grab;
  transition:
    background-color 120ms,
    color 120ms,
    border-color 120ms;
}
.mlist-gjs .gjs-block:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  border-color: var(--ui-border-accented);
  box-shadow: none;
}
.mlist-gjs .gjs-block__media {
  margin: 0;
}
.mlist-gjs .gjs-block svg {
  width: 22px;
  height: 22px;
}
.mlist-gjs .gjs-block-label {
  font: 500 12px/16px var(--font-sans);
  color: var(--ui-text);
}

/* Layers */
.mlist-gjs .gjs-layer {
  font-weight: 400;
  font-size: 13px;
  color: var(--ui-text);
  background: transparent;
}
.mlist-gjs .gjs-layer-item {
  background: transparent;
  border-bottom: 0;
  padding-top: 4px;
  padding-bottom: 4px;
}
.mlist-gjs .gjs-layer-item:hover,
.mlist-gjs .gjs-layer.gjs-hovered > .gjs-layer-item {
  background: var(--ui-bg-elevated);
}
.mlist-gjs .gjs-layer.gjs-selected > .gjs-layer-item {
  background: color-mix(in oklab, var(--ui-primary) 12%, transparent);
  color: var(--ui-text-highlighted);
}
.mlist-gjs .gjs-layer-name {
  padding: 2px 0;
}
.mlist-gjs .gjs-layer-count {
  color: var(--ui-text-muted);
}

/* Style manager & traits */
.mlist-gjs .gjs-sm-sector {
  border-bottom: 1px solid var(--ui-border);
  font-weight: 400;
}
.mlist-gjs .gjs-sm-sector.gjs-sm-open {
  border-bottom: 1px solid var(--ui-border);
}
.mlist-gjs .gjs-sm-properties {
  padding: 0 8px 12px;
  font-size: 12px;
}
.mlist-gjs .gjs-sm-property {
  padding: 0 4px;
  margin-bottom: 8px;
}
.mlist-gjs .gjs-sm-label,
.mlist-gjs .gjs-label {
  color: var(--ui-text-muted);
  font-size: 12px;
  margin: 0 0 4px;
}
.mlist-gjs .gjs-sm-label.gjs-four-color {
  color: var(--ui-primary);
}
.mlist-gjs .gjs-field,
.mlist-gjs .gjs-sm-field.gjs-sm-select,
.mlist-gjs .gjs-sm-field.gjs-sm-input,
.mlist-gjs .gjs-sm-field.gjs-sm-integer,
.mlist-gjs .gjs-sm-field.gjs-sm-color {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  border: 1px solid var(--ui-border-accented);
  border-radius: 6px;
  box-shadow: none;
  min-height: 28px;
}
.mlist-gjs .gjs-field:focus-within {
  border-color: var(--ui-primary);
  box-shadow: 0 0 0 1px var(--ui-primary);
}
.mlist-gjs .gjs-field input,
.mlist-gjs .gjs-field select,
.mlist-gjs .gjs-field textarea {
  color: var(--ui-text-highlighted);
  font: 400 12px/16px var(--font-sans);
}
.mlist-gjs .gjs-field select option {
  background: var(--ui-bg);
  color: var(--ui-text);
}
.mlist-gjs .gjs-field-colorp {
  border-left-color: var(--ui-border);
}
.mlist-gjs .gjs-field-color-picker {
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--ui-border);
}
.mlist-gjs .gjs-radio-items {
  border-radius: 6px;
  overflow: hidden;
}
.mlist-gjs .gjs-radio-item {
  border-left: 1px solid var(--ui-border);
}
.mlist-gjs .gjs-radio-item:hover {
  background: var(--ui-bg-elevated);
}
.mlist-gjs .gjs-radio-item input:checked + .gjs-radio-item-label {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}
.mlist-gjs .gjs-sm-composite.gjs-sm-field,
.mlist-gjs .gjs-sm-property.gjs-sm-composite .gjs-sm-properties {
  background: transparent;
  border: 0;
  padding: 0;
}
.mlist-gjs .gjs-sm-property .gjs-sm-btn {
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
  box-shadow: none;
  text-shadow: none;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.mlist-gjs .gjs-sm-layer {
  background: var(--ui-bg-elevated);
}
.mlist-gjs .gjs-sm-clear {
  color: var(--ui-text-muted);
}
.mlist-gjs .gjs-trt-traits {
  padding: 8px 4px;
  font-size: 12px;
}
.mlist-gjs .gjs-trt-trait {
  padding: 4px 8px;
  font-weight: 400;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}
.mlist-gjs .gjs-trt-trait .gjs-label-wrp {
  width: 100%;
  min-width: 0;
}
.mlist-gjs .gjs-trt-header {
  display: none;
}
.mlist-gjs .gjs-clm-tags {
  display: none;
}
</style>
