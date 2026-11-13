<script setup lang="ts">
import { MjmlFormatter, templateEditorSchema } from '#shared/schemas/templates'
import type {
  TemplateDesign,
  TemplateDto,
  TemplateSaveResult,
  TemplateUpdateInput
} from '#shared/schemas/templates'
import type { TemplaticalEditorApi } from '#shared/schemas/template-design'

definePageMeta({ permission: { template: ['read'] } })

type Mode = TemplateDto['editor']

type Device = 'desktop' | 'mobile'

type CodeEditorHandle = { insertAtCursor: (snippet: string) => void; focus: () => void }

const route = useRoute()
const id = String(route.params.id)
const { can } = useOrganization()

/** Without `template:update` the page is a read-only view: no inputs, editors, saves or guards. */
const canEdit = computed(() => can({ template: ['update'] }))
const canUpload = computed(() => can({ file: ['create'] }))

const { data: template, error } = await useFetch<TemplateDto>(`/api/templates/${id}`)

// 404 for unknown or malformed ids (including other organizations'); 403 / 409 keep their own status.
if (error.value || !template.value) {
  const status = error.value?.statusCode ?? 404
  const statusCode = status === 422 ? 404 : status

  throw createError({
    statusCode,
    statusMessage: statusCode === 404 ? 'Template not found' : error.value?.statusMessage,
    message: statusCode === 404 ? 'Template not found' : apiErrorMessage(error.value),
    fatal: true
  })
}

const initial = template.value

const notify = useNotify()
const confirm = useConfirm()
const formatter = new MjmlFormatter()

// Editable state -------------------------------------------------------------
const meta = reactive({
  name: initial.name,
  subject: initial.subject,
  preheader: initial.preheader ?? ''
})

const saved = reactive({
  ...meta,
  mjml: initial.mjml,
  editor: initial.editor,
  updatedAt: initial.updatedAt
})

useSeoMeta({ title: () => meta.name || 'Template' })

const mode = ref<Mode>(initial.editor)
const device = ref<Device>('desktop')

/** MJML source: the code editor's model, and the last known content in visual mode. */
const mjml = ref(initial.mjml)

/** What the visual editor loads when it mounts. */
const visualSource = shallowRef<{ mjml: string; design: TemplateDesign | null }>({
  mjml: initial.mjml,
  design: initial.design
})

const visualApi = shallowRef<TemplaticalEditorApi | null>(null)

/** The content the visual editor opened is not saved yet (code edited, or an unsaved export). */
const visualSourceDirty = ref(false)

/** The visual editor holds edits since it opened or last saved (the editor tells). */
const visualEdited = ref(false)

/** Set when the visual editor could not open the template; its stored content is kept. */
const visualFailed = ref(false)

/**
 * The code that matches the visual editor while it has no new edits: the
 * stored MJML, or the code written before switching to visual. Going back to
 * Code without editing restores it instead of MJML regenerated from blocks.
 */
let codeBaseline = initial.mjml

/** Last visual export when switching to code, reused if the code is left untouched. */
let exported: { mjml: string; design: TemplateDesign; changed: boolean } | null = null

const codeEditor = useTemplateRef<CodeEditorHandle>('codeEditor')
const nameInput = useTemplateRef('nameInput')

/** Images & variables slideover of the code editor on narrow screens. */
const panelOpen = ref(false)

/** Set when the slideover closes after an insert, so focus goes back to the code. */
let refocusCode = false

/** Set by a save attempt with an empty name; cleared as soon as one is typed. */
const nameInvalid = ref(false)

watch(
  () => meta.name,
  (name) => {
    if (name.trim()) nameInvalid.value = false
  }
)

const metaDirty = computed(
  () =>
    meta.name.trim() !== saved.name ||
    meta.subject.trim() !== saved.subject ||
    meta.preheader.trim() !== saved.preheader
)

const contentDirty = computed(
  () =>
    mode.value !== saved.editor ||
    (mode.value === 'code'
      ? mjml.value !== saved.mjml
      : visualSourceDirty.value || visualEdited.value)
)

/**
 * Whether the email body differs from the saved one, asking the visual editor
 * directly: its own change report can lag behind the latest keystroke.
 */
function contentChanged(): boolean {
  if (mode.value !== saved.editor) return true

  if (mode.value === 'code') return mjml.value !== saved.mjml

  return visualSourceDirty.value || (visualApi.value?.isChanged() ?? false)
}

const dirty = computed(() => canEdit.value && (metaDirty.value || contentDirty.value))

// Save -----------------------------------------------------------------------
const { run: patch, pending: saving } = useApiAction(
  (body: TemplateUpdateInput) =>
    $fetch<TemplateSaveResult>(`/api/templates/${id}`, { method: 'PATCH', body }),
  { error: 'Template not saved' }
)

let inflight: Promise<boolean> | null = null

function save(): Promise<boolean> {
  if (!canEdit.value) return Promise.resolve(false)

  inflight ??= doSave().finally(() => {
    inflight = null
  })

  return inflight
}

async function doSave(): Promise<boolean> {
  const name = meta.name.trim()

  if (!name) {
    nameInvalid.value = true
    nameInput.value?.inputRef?.focus()
    notify.error('Name is required', undefined, {
      description: 'Give the template a name before saving.'
    })

    return false
  }

  const body: TemplateUpdateInput = {
    name,
    subject: meta.subject.trim(),
    preheader: meta.preheader.trim() || null,
    editor: mode.value
  }

  const api = visualApi.value
  const changed = contentChanged()
  let keptStoredContent = false

  // The email body goes only when it changed: renaming a template must not
  // rewrite content the visual editor converted when it opened.
  if (changed && mode.value === 'code') {
    body.mjml = mjml.value
  } else if (changed) {
    const content = await api?.getContent()

    if (content) {
      body.mjml = content.mjml
      body.design = content.design
    } else if (visualFailed.value) {
      body.editor = saved.editor
      keptStoredContent = true
    } else {
      notify.warning('The editor is still loading', { description: 'Try again in a moment.' })

      return false
    }
  }

  const result = await patch(body)

  if (!result) return false

  // Fields typed while the save was running keep the new text.
  if (meta.name.trim() === body.name) meta.name = result.name

  if (meta.subject.trim() === body.subject) meta.subject = result.subject

  if ((meta.preheader.trim() || null) === body.preheader) meta.preheader = result.preheader ?? ''

  Object.assign(saved, {
    name: result.name,
    subject: result.subject,
    preheader: result.preheader ?? '',
    mjml: result.mjml,
    editor: result.editor,
    updatedAt: result.updatedAt
  })
  template.value = result

  // Edits made while the save was running stay unsaved: the editor compares with what was sent.
  if (body.design && api && visualApi.value === api) {
    mjml.value = result.mjml
    codeBaseline = result.mjml
    visualSourceDirty.value = false
    api.markSaved(body.design)
  }

  if (keptStoredContent) {
    notify.warning('Only the name, subject and preheader were saved', {
      description:
        "The visual editor couldn't open this email. To change its content, switch to Code."
    })

    return true
  }

  const [first] = result.warnings

  if (first) {
    const count = result.warnings.length
    notify.warning(`Saved with ${count} ${count === 1 ? 'issue' : 'issues'}`, {
      description: `${first.line ? `Line ${first.line}: ` : ''}${first.message}`
    })
  } else {
    notify.success('Template saved')
  }

  return true
}

// ⌘S saves; not bound for members who may only read the template.
defineShortcuts(
  computed(() => ({
    meta_s: canEdit.value ? { usingInput: true, handler: () => void save() } : false
  }))
)

// Mode switching ---------------------------------------------------------------

/** Set while a switch checks the code or asks; a second click then starts nothing. */
let switching = false

async function switchMode(next: Mode) {
  if (switching) return

  switching = true

  try {
    await changeMode(next)
  } finally {
    switching = false
  }
}

async function changeMode(next: Mode) {
  if (next === mode.value) return

  // Read-only views just change what is shown (saved content as preview or source).
  if (!canEdit.value) {
    mode.value = next

    return
  }

  if (next === 'code') {
    const api = visualApi.value
    const content = await api?.getContent()
    const edited = api?.isChanged() ?? false

    const source = !edited
      ? codeBaseline
      : content
        ? formatter.format(content.mjml)
        : visualSource.value.mjml

    exported = {
      mjml: source,
      design: content?.design ?? visualSource.value.design ?? {},
      changed: visualSourceDirty.value || edited
    }
    mjml.value = source
    visualApi.value = null
    visualFailed.value = false
    mode.value = 'code'

    return
  }

  const untouched =
    exported !== null && exported.mjml === mjml.value && Object.keys(exported.design).length > 0

  if (!untouched) {
    const lost = await unsupportedLogicIn(mjml.value)

    const ok = await confirm(
      lost
        ? {
            title: "Some personalization won't come along",
            // `lost` counts Liquid tags, not rules: no number, so it cannot mislead.
            description:
              "Some sections of this email are wrapped in personalization (Liquid tags). The visual editor can't fully keep it, so those sections may show to everyone or look broken. To keep it working, stay in Code.",
            confirmLabel: 'Switch anyway',
            cancelLabel: 'Stay in Code',
            danger: true
          }
        : {
            title: 'Switch to the visual editor?',
            description:
              "Your email becomes blocks you can drag and edit. Anything that can't become a block stays as HTML, and spacing may shift a little. If you come back to Code without editing, your code stays exactly as it was.",
            confirmLabel: 'Switch to visual'
          }
    )

    if (!ok) return
  }

  codeBaseline = mjml.value
  visualFailed.value = false

  visualSource.value =
    untouched && exported
      ? { mjml: mjml.value, design: exported.design }
      : { mjml: mjml.value, design: null }
  visualSourceDirty.value = untouched && exported ? exported.changed : mjml.value !== saved.mjml
  visualEdited.value = false
  mode.value = 'visual'
}

function onModeChange(value: string | number) {
  const next = templateEditorSchema.safeParse(value)

  if (next.success) void switchMode(next.data)
}

function onVisualReady(api: TemplaticalEditorApi) {
  visualApi.value = api
}

function onVisualChange(edited: boolean) {
  visualEdited.value = edited
}

/** Liquid tags the visual editor would lose; the editor reports anything else once it opens. */
async function unsupportedLogicIn(source: string): Promise<number> {
  const { MjmlBlockImporter } = await import('#shared/templates/MjmlBlockImporter')

  try {
    return new MjmlBlockImporter().import(source).unsupportedLogic
  } catch {
    return 0
  }
}

function blurTarget(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement) event.target.blur()
}

// Side panel ----------------------------------------------------------------
function escapeAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function closePanelAfterInsert() {
  if (!panelOpen.value) return
  refocusCode = true
  panelOpen.value = false
}

/** Code editor only: the visual editor has its own image picker. */
function onInsertImage(url: string, alt: string) {
  codeEditor.value?.insertAtCursor(`<mj-image src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />`)
  closePanelAfterInsert()
}

function onInsertText(text: string) {
  codeEditor.value?.insertAtCursor(text)
  closePanelAfterInsert()
}

/** After an insert, focus returns to the code (at the inserted text), not to the toggle. */
function onPanelCloseAutoFocus(event: Event) {
  if (!refocusCode) return
  refocusCode = false
  event.preventDefault()
  codeEditor.value?.focus()
}

// Unsaved changes guard ----------------------------------------------------------
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true

  return await confirm({
    title: 'Discard unsaved changes?',
    description: 'Your latest edits to this template have not been saved.',
    confirmLabel: 'Discard changes',
    danger: true
  })
})

useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
})

async function beforeSend() {
  return dirty.value ? await save() : true
}

const modeItems = [
  { label: 'Visual', value: 'visual', icon: 'i-lucide-mouse-pointer-2' },
  { label: 'Code', value: 'code', icon: 'i-lucide-code-xml' }
]

const kindBadge =
  initial.kind === 'transactional'
    ? { label: 'Transactional', icon: 'i-lucide-zap' }
    : { label: 'Marketing', icon: 'i-lucide-megaphone' }

/** Subject and preheader sit inline in the toolbar: label beside the control. */
const metaFieldUi = {
  root: 'flex-1 min-w-0 place-items-center gap-2',
  wrapper: 'w-20 sm:w-auto shrink-0',
  label: 'text-xs font-medium text-muted',
  container: 'flex-1 min-w-0'
}
</script>

<template>
  <UDashboardPanel id="template-editor" :ui="{ body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :ui="{ root: 'gap-3', left: 'flex-1', title: 'flex-1 min-w-24 max-w-sm' }">
        <template #leading>
          <UTooltip text="Back to templates">
            <UButton
              icon="i-lucide-arrow-left"
              variant="ghost"
              to="/templates"
              aria-label="Back to templates"
            />
          </UTooltip>
        </template>

        <template #title>
          <UInput
            ref="nameInput"
            v-model="meta.name"
            variant="ghost"
            placeholder="Untitled template"
            aria-label="Template name"
            maxlength="120"
            class="w-full"
            :color="nameInvalid ? 'error' : 'neutral'"
            :highlight="nameInvalid"
            :aria-invalid="nameInvalid || undefined"
            :disabled="!canEdit"
            :ui="{
              base: 'font-semibold text-highlighted text-base px-1.5 hover:bg-elevated/60 focus-visible:bg-default focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accented disabled:opacity-100'
            }"
            @keydown.enter="blurTarget"
          />
        </template>

        <template #trailing>
          <UBadge
            variant="outline"
            class="shrink-0 hidden sm:inline-flex"
            :icon="kindBadge.icon"
            :label="kindBadge.label"
          />
          <CopyText
            v-if="template?.slug"
            :value="template.slug"
            class="hidden xl:inline-flex max-w-40"
          />
          <span
            class="hidden md:inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap ms-1"
            aria-live="polite"
          >
            <template v-if="!canEdit">
              <UIcon name="i-lucide-eye" class="size-3.5" /> View only
            </template>
            <template v-else-if="saving">
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" /> Saving…
            </template>
            <template v-else-if="dirty">
              <UChip standalone inset color="warning" size="md" /> Unsaved changes
            </template>
            <template v-else>
              <UIcon name="i-lucide-check" class="size-3.5" /> Saved
              <ClientOnly><TimeAgo :date="saved.updatedAt" /></ClientOnly>
            </template>
          </span>
        </template>

        <template #right>
          <UTabs
            :model-value="mode"
            :items="modeItems"
            :content="false"
            size="xs"
            color="neutral"
            aria-label="Editor mode"
            :ui="{ label: 'max-sm:sr-only' }"
            @update:model-value="onModeChange"
          />
          <!-- The visual editor has its own desktop / mobile switch. -->
          <UFieldGroup
            v-if="mode === 'code' || !canEdit"
            class="hidden sm:inline-flex"
            aria-label="Preview width"
          >
            <UTooltip text="Desktop preview">
              <UButton
                icon="i-lucide-monitor"
                :variant="device === 'desktop' ? 'subtle' : 'outline'"
                :aria-pressed="device === 'desktop'"
                aria-label="Desktop preview"
                @click="device = 'desktop'"
              />
            </UTooltip>
            <UTooltip text="Mobile preview">
              <UButton
                icon="i-lucide-smartphone"
                :variant="device === 'mobile' ? 'subtle' : 'outline'"
                :aria-pressed="device === 'mobile'"
                aria-label="Mobile preview"
                @click="device = 'mobile'"
              />
            </UTooltip>
          </UFieldGroup>
          <TemplatesSendTestPopover :template-id="id" :before-send="beforeSend" />
          <Can
            v-slot="{ allowed }"
            :permission="{ template: ['update'] }"
            explain="You don't have permission to edit templates"
          >
            <UTooltip text="Save" :kbds="['meta', 's']" :disabled="!allowed">
              <UButton
                label="Save"
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!allowed || !dirty"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Save template"
                @click="save"
              />
            </UTooltip>
          </Can>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar
        :ui="{
          root: 'gap-3 py-1.5',
          left: 'flex-1 min-w-0 flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4'
        }"
      >
        <template #left>
          <UFormField label="Subject" name="subject" orientation="horizontal" :ui="metaFieldUi">
            <UInput
              v-model="meta.subject"
              placeholder="What recipients see in their inbox"
              size="sm"
              maxlength="300"
              class="w-full"
              :disabled="!canEdit"
            />
          </UFormField>
          <UFormField label="Preheader" name="preheader" orientation="horizontal" :ui="metaFieldUi">
            <UInput
              v-model="meta.preheader"
              placeholder="Preview text shown after the subject"
              size="sm"
              maxlength="300"
              class="w-full"
              :disabled="!canEdit"
            />
          </UFormField>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="relative flex-1 min-h-0 flex">
        <TemplatesReadOnlyPreview
          v-if="mode === 'visual' && !canEdit"
          :mjml="saved.mjml"
          :subject="saved.subject"
          :preheader="saved.preheader || null"
          :device="device"
        />

        <LazyTemplatesTemplaticalEditor
          v-else-if="mode === 'visual'"
          :mjml="visualSource.mjml"
          :design="visualSource.design"
          :kind="initial.kind"
          :can-upload="canUpload"
          class="flex-1"
          @ready="onVisualReady"
          @change="onVisualChange"
          @failed="visualFailed = true"
        />

        <template v-else>
          <LazyTemplatesMjmlCodeEditor
            ref="codeEditor"
            v-model="mjml"
            :subject="meta.subject"
            :preheader="meta.preheader || null"
            :device="device"
            :readonly="!canEdit"
            class="flex-1 min-w-0"
          >
            <template v-if="canEdit" #toolbar>
              <UTooltip text="Images and variables">
                <UButton
                  icon="i-lucide-panel-right"
                  size="sm"
                  variant="ghost"
                  aria-label="Show images and variables"
                  @click="panelOpen = true"
                />
              </UTooltip>
            </template>
          </LazyTemplatesMjmlCodeEditor>
          <aside
            v-if="canEdit"
            class="hidden lg:block w-72 shrink-0 overflow-y-auto border-s border-default bg-default"
            aria-label="Images and variables"
          >
            <TemplatesSidePanel
              can-insert-text
              @insert-image="onInsertImage"
              @insert-text="onInsertText"
            />
          </aside>
          <USlideover
            v-if="canEdit"
            v-model:open="panelOpen"
            title="Images and variables"
            description="Insert images and Liquid tags at the cursor."
            :content="{ onCloseAutoFocus: onPanelCloseAutoFocus }"
            :ui="{ content: 'max-w-xs', body: 'p-0 sm:p-0' }"
          >
            <template #body>
              <TemplatesSidePanel
                can-insert-text
                @insert-image="onInsertImage"
                @insert-text="onInsertText"
              />
            </template>
          </USlideover>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
