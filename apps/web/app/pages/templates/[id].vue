<script setup lang="ts">
import { MjmlFormatter, templateEditorSchema } from '#shared/schemas/templates'
import type {
  TemplateDesign,
  TemplateDto,
  TemplateSaveResult,
  TemplateUpdateInput,
  VisualEditorApi
} from '#shared/schemas/templates'

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

const visualApi = shallowRef<VisualEditorApi | null>(null)
const visualChanged = ref(false)

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
    (mode.value === 'code' ? mjml.value !== saved.mjml : visualChanged.value)
)

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

  if (mode.value === 'visual') {
    const content = visualApi.value?.getContent()

    if (!content) {
      notify.warning('The editor is still loading', { description: 'Try again in a moment.' })

      return false
    }

    body.mjml = content.mjml
    body.design = content.design
  } else {
    body.mjml = mjml.value
  }

  const result = await patch(body)

  if (!result) return false

  Object.assign(meta, {
    name: result.name,
    subject: result.subject,
    preheader: result.preheader ?? ''
  })
  Object.assign(saved, {
    name: result.name,
    subject: result.subject,
    preheader: result.preheader ?? '',
    mjml: result.mjml,
    editor: result.editor,
    updatedAt: result.updatedAt
  })
  template.value = result

  if (mode.value === 'visual') {
    mjml.value = result.mjml
    visualChanged.value = false
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
async function switchMode(next: Mode) {
  if (next === mode.value) return

  // Read-only views just change what is shown (saved content as preview or source).
  if (!canEdit.value) {
    mode.value = next

    return
  }

  if (next === 'code') {
    const content = visualApi.value?.getContent()
    const source = content ? formatter.format(content.mjml) : visualSource.value.mjml
    exported = {
      mjml: source,
      design: content?.design ?? visualSource.value.design ?? {},
      changed: visualChanged.value
    }
    mjml.value = source
    visualApi.value = null
    mode.value = 'code'

    return
  }

  const untouched =
    exported !== null && exported.mjml === mjml.value && Object.keys(exported.design).length > 0

  if (!untouched) {
    const ok = await confirm({
      title: 'Switch to the visual editor?',
      description:
        'The visual editor rebuilds the layout from your MJML. Raw HTML and tags it does not support may change when you save.',
      confirmLabel: 'Switch to visual'
    })

    if (!ok) return
  }

  visualSource.value =
    untouched && exported
      ? { mjml: mjml.value, design: exported.design }
      : { mjml: mjml.value, design: null }
  visualChanged.value = untouched && exported ? exported.changed : mjml.value !== saved.mjml
  mode.value = 'visual'
}

function onModeChange(value: string | number) {
  const next = templateEditorSchema.safeParse(value)

  if (next.success) void switchMode(next.data)
}

function onVisualReady(api: VisualEditorApi) {
  visualApi.value = api
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

function onInsertImage(url: string, alt: string) {
  if (mode.value === 'visual') {
    visualApi.value?.insertImage(url, alt)
  } else {
    codeEditor.value?.insertAtCursor(
      `<mj-image src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />`
    )
  }

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
          <UFieldGroup class="hidden sm:inline-flex" aria-label="Preview width">
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

        <LazyTemplatesMjmlVisualEditor
          v-else-if="mode === 'visual'"
          :mjml="visualSource.mjml"
          :design="visualSource.design"
          :device="device"
          :can-upload="canUpload"
          class="flex-1 min-w-0"
          @ready="onVisualReady"
          @change="visualChanged = true"
          @save="save"
        >
          <template #panel>
            <TemplatesSidePanel @insert-image="onInsertImage" />
          </template>
        </LazyTemplatesMjmlVisualEditor>

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
