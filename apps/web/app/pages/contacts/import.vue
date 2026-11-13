<script setup lang="ts">
import type { FormSubmitEvent, TableColumn, TimelineItem } from '@nuxt/ui'
import Papa from 'papaparse'
import type { LocationQueryValue } from 'vue-router'
import { z } from 'zod'
import { toAttributeKey } from '#shared/schemas/contacts'
import {
  ATTRIBUTE_TARGET_PREFIX,
  CSV_PARSE_OPTIONS,
  MAX_IMPORT_CSV_BYTES,
  importMappingSchema,
  importModeSchema,
  importSubscriptionStatusSchema
} from '#shared/schemas/imports'
import type { ImportCreateInput } from '#shared/schemas/imports'
import type { ImportDetail, ImportSummary } from '#shared/types/contacts'

// Covers every control of the wizard (start, replace file, new import).
definePageMeta({ permission: { contact: ['import'] } })

useSeoMeta({ title: 'Import contacts' })

const route = useRoute()
const router = useRouter()
const { number, bytes } = useFormat()

const fieldChoiceSchema = z.enum(['email', 'first_name', 'last_name', 'attribute', 'ignore'])

type FieldChoice = z.infer<typeof fieldChoiceSchema>

interface ColumnMapping {
  column: string
  field: FieldChoice
  key: string
  sample: string
}

/** First value of a query parameter (`?id=a&id=b` → `a`). */
function queryValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

// Active import (kept in the URL so a refresh keeps showing progress) ------------
const importId = computed(() => queryValue(route.query.id))

function showImport(id: string | null) {
  router.replace({ query: { ...route.query, id: id ?? undefined } })
}

const {
  data: recent,
  status: recentStatus,
  refresh: refreshRecent
} = useFetch<ImportSummary[]>('/api/imports', {
  query: { limit: 10 },
  default: () => []
})

const { data: lists } = useFetch('/api/lists', { default: () => [], key: 'import-lists' })

// 1. File ---------------------------------------------------------------------------
const file = ref<File | null>(null)
const csv = ref('')
const headers = ref<string[]>([])
const previewRows = ref<Record<string, string>[]>([])
const rowCount = ref<number | null>(null)
const parseError = ref<string | null>(null)
const parsing = ref(false)
const columns = ref<ColumnMapping[]>([])

const EMAIL_HEADERS = new Set([
  'email',
  'emailaddress',
  'mail',
  'email1',
  'emailadres',
  'correo',
  'courriel',
  'emailaddresse'
])

const FIRST_NAME_HEADERS = new Set([
  'firstname',
  'first',
  'givenname',
  'fname',
  'forename',
  'name',
  'nome',
  'prenom',
  'vorname',
  'nombre'
])

const LAST_NAME_HEADERS = new Set([
  'lastname',
  'last',
  'surname',
  'familyname',
  'lname',
  'cognome',
  'nom',
  'nachname',
  'apellido'
])

/** Guesses the target from common header spellings ("E-mail", "First Name", "surname"…). */
function guessField(header: string, taken: Set<FieldChoice>): FieldChoice {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '')
  const pick = (field: FieldChoice) => (taken.has(field) ? 'attribute' : field)

  if (EMAIL_HEADERS.has(h) || /^e?mail/.test(h)) return pick('email')

  if (FIRST_NAME_HEADERS.has(h)) return pick('first_name')

  if (LAST_NAME_HEADERS.has(h)) return pick('last_name')

  return 'attribute'
}

function resetFile() {
  file.value = null
  csv.value = ''
  headers.value = []
  previewRows.value = []
  rowCount.value = null
  parseError.value = null
  columns.value = []
}

async function readFile(selected: File) {
  parsing.value = true
  parseError.value = null

  try {
    if (selected.size > MAX_IMPORT_CSV_BYTES)
      throw new Error(
        `The file is ${bytes(selected.size)}. The maximum is 50 MB; split it into smaller files.`
      )
    const text = await selected.text()
    const preview = Papa.parse<Record<string, string>>(text, { ...CSV_PARSE_OPTIONS, preview: 5 })
    const fields = (preview.meta.fields ?? []).filter(Boolean)

    if (!fields.length)
      throw new Error('The file has no header row. The first line must contain column names.')

    csv.value = text
    headers.value = fields
    previewRows.value = preview.data
    const taken = new Set<FieldChoice>()
    columns.value = fields.map((column) => {
      const field = guessField(column, taken)

      if (field !== 'attribute') taken.add(field)
      const sample = preview.data.map((r) => r[column]?.trim()).find(Boolean) ?? ''

      return { column, field, key: toAttributeKey(column), sample }
    })

    // Count rows after the preview is on screen (large files take a moment).
    rowCount.value = null
    await new Promise((resolve) => setTimeout(resolve, 0))
    let count = 0
    Papa.parse<Record<string, string>>(text, {
      ...CSV_PARSE_OPTIONS,
      step: () => {
        count++
      }
    })
    rowCount.value = count

    if (!count) parseError.value = 'The file has a header but no data rows.'
  } catch (error) {
    resetFile()
    parseError.value = error instanceof Error ? error.message : 'Could not read the file.'
  } finally {
    parsing.value = false
  }
}

watch(file, (value) => {
  if (value) readFile(value)
})

function onReject() {
  parseError.value = 'Only .csv files are supported. Export your spreadsheet as CSV (UTF-8) first.'
}

const previewColumns = computed<TableColumn<Record<string, string>>[]>(() =>
  headers.value.map((header) => ({
    id: header,
    header,
    accessorFn: (row: Record<string, string>) => row[header] ?? '',
    meta: {
      class: { th: 'min-w-36 whitespace-nowrap', td: 'min-w-36 max-w-64 truncate text-muted' }
    }
  }))
)

const fileMeta = computed(() => {
  if (!file.value) return ''
  const rows = rowCount.value === null ? 'counting rows…' : `${number(rowCount.value)} rows`

  return `${bytes(file.value.size)} · ${rows} · ${number(headers.value.length)} columns`
})

// 2. Mapping ------------------------------------------------------------------------
const fieldItems = [
  { label: 'Email', value: 'email', icon: 'i-lucide-at-sign' },
  { label: 'First name', value: 'first_name', icon: 'i-lucide-user' },
  { label: 'Last name', value: 'last_name', icon: 'i-lucide-user' },
  { label: 'Custom attribute', value: 'attribute', icon: 'i-lucide-braces' },
  { label: "Don't import", value: 'ignore', icon: 'i-lucide-eye-off' }
]

const mapping = computed(() =>
  Object.fromEntries(
    columns.value.map((c) => [
      c.column,
      c.field === 'attribute' ? `${ATTRIBUTE_TARGET_PREFIX}${c.key.trim()}` : c.field
    ])
  )
)

const mappingIssue = computed(() => {
  if (!columns.value.length) return null
  const result = importMappingSchema.safeParse(mapping.value)

  return result.success ? null : (result.error.issues[0]?.message ?? 'Check the column mapping')
})

const keyErrors = computed(() => {
  const seen = new Set<string>()
  const errors: Record<string, string> = {}

  for (const c of columns.value) {
    if (c.field !== 'attribute') continue
    const key = c.key.trim()

    if (!/^[a-z_]\w{0,63}$/i.test(key)) errors[c.column] = 'Letters, numbers and _ only'
    else if (seen.has(key)) errors[c.column] = 'Already used'
    seen.add(key)
  }

  return errors
})

/** Applies a choice from the "Import as" select (decoded at the boundary). */
function onFieldSelect(target: ColumnMapping, value: string) {
  const parsed = fieldChoiceSchema.safeParse(value)

  if (parsed.success) onFieldChange(target, parsed.data)
}

function onFieldChange(target: ColumnMapping, field: FieldChoice) {
  // Built-in fields are unique: picking one frees it from any other column.
  if (field !== 'attribute' && field !== 'ignore') {
    for (const c of columns.value) {
      if (c !== target && c.field === field) c.field = 'attribute'
    }
  }

  target.field = field
}

const mappedCount = computed(() => columns.value.filter((c) => c.field !== 'ignore').length)

const USelect = resolveComponent('USelect')
const UInput = resolveComponent('UInput')
const UFormField = resolveComponent('UFormField')

const mappingColumns: TableColumn<ColumnMapping>[] = [
  {
    accessorKey: 'column',
    header: 'Column in file',
    cell: ({ row }) =>
      h(
        'span',
        { class: 'block truncate font-medium text-highlighted', title: row.original.column },
        row.original.column
      )
  },
  {
    accessorKey: 'sample',
    header: 'Sample',
    meta: {
      class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell font-mono text-muted' }
    },
    cell: ({ row }) =>
      row.original.sample
        ? h('span', { class: 'block truncate', title: row.original.sample }, row.original.sample)
        : emptyCell()
  },
  {
    accessorKey: 'field',
    header: 'Import as',
    meta: { class: { th: 'w-44', td: 'w-44 align-top' } },
    cell: ({ row }) =>
      h(USelect, {
        modelValue: row.original.field,
        items: fieldItems,
        size: 'sm',
        class: 'w-full',
        'aria-label': `Import ${row.original.column} as`,
        'onUpdate:modelValue': (value: string) => onFieldSelect(row.original, value)
      })
  },
  {
    accessorKey: 'key',
    header: 'Attribute key',
    meta: { class: { th: 'w-44', td: 'w-44 align-top' } },
    cell: ({ row }) => {
      const target = row.original

      if (target.field !== 'attribute') return emptyCell()

      return h(UFormField, { error: keyErrors.value[target.column], size: 'sm' }, () =>
        h(UInput, {
          modelValue: target.key,
          size: 'sm',
          class: 'w-full',
          ui: { base: 'font-mono' },
          'aria-label': `Attribute key for ${target.column}`,
          'onUpdate:modelValue': (value: string) => {
            target.key = value
          },
          onBlur: () => {
            target.key = target.key.trim() ? target.key : toAttributeKey(target.column)
          }
        })
      )
    }
  }
]

// 3. Options ------------------------------------------------------------------------
const optionsSchema = z.object({
  listId: z.string(),
  mode: importModeSchema,
  subscriptionStatus: importSubscriptionStatusSchema
})

type ImportOptions = z.output<typeof optionsSchema>

const options = reactive<ImportOptions>({
  listId: queryValue(route.query.listId) ?? 'none',
  mode: 'merge',
  subscriptionStatus: 'send_opt_in'
})

const listItems = computed(() => [
  { label: "Don't add to a list", value: 'none' },
  ...lists.value.map((l) => ({
    label: l.name,
    value: l.id,
    description: l.optIn === 'double' ? 'Double opt-in' : undefined
  }))
])

const selectedList = computed(() => lists.value.find((l) => l.id === options.listId))

const modeItems = [
  {
    value: 'merge',
    label: 'Update existing contacts',
    description:
      'Add new contacts and fill in names and attributes of existing ones. Empty cells never erase data.'
  },
  {
    value: 'skip',
    label: 'Skip existing contacts',
    description:
      'Only add new contacts. Existing ones keep their data (they are still added to the list).'
  },
  {
    value: 'overwrite',
    label: 'Overwrite existing contacts',
    description:
      'Replace names and attributes of existing contacts with the file, including empty cells.'
  }
]

const subscriptionItems = [
  {
    value: 'send_opt_in',
    label: 'Send a confirmation email',
    description: 'Contacts join as unconfirmed and receive the opt-in email. Recommended.'
  },
  {
    value: 'confirmed',
    label: 'Subscribe as confirmed',
    description: 'Only when these people already agreed to receive your emails.'
  }
]

// Start -----------------------------------------------------------------------------
const ready = computed(
  () =>
    !!csv.value &&
    !!rowCount.value &&
    !parsing.value &&
    !mappingIssue.value &&
    !Object.keys(keyErrors.value).length
)

const { run: startImport, pending: starting } = useApiAction(
  (body: ImportCreateInput) => $fetch<ImportDetail>('/api/imports', { method: 'POST', body }),
  { success: 'Import started', error: 'Could not start the import' }
)

async function start(event: FormSubmitEvent<ImportOptions>) {
  if (!ready.value || !file.value) return

  const created = await startImport({
    fileName: file.value.name,
    csv: csv.value,
    mapping: mapping.value,
    mode: event.data.mode,
    listId: event.data.listId === 'none' ? null : event.data.listId,
    subscriptionStatus:
      selectedList.value?.optIn === 'double' ? event.data.subscriptionStatus : 'confirmed'
  })

  if (!created) return
  resetFile()
  showImport(created.id)
  await refreshRecent()
}

function newImport() {
  resetFile()
  showImport(null)
}

async function onFinished() {
  await refreshRecent()
}

const summary = computed(() => {
  if (!rowCount.value) return null
  const target = selectedList.value ? ` into ${selectedList.value.name}` : ''

  return `${number(rowCount.value)} row${rowCount.value === 1 ? '' : 's'}${target}`
})

// Wizard steps (a vertical timeline: done steps turn solid with a check) --------------
const mappingValid = computed(() => !mappingIssue.value && !Object.keys(keyErrors.value).length)

const steps = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [
    {
      value: 'file',
      slot: 'file',
      icon: csv.value ? 'i-lucide-check' : undefined,
      avatar: { text: '1' }
    }
  ]

  if (!columns.value.length) return items

  items.push(
    {
      value: 'map',
      slot: 'map',
      icon: mappingValid.value ? 'i-lucide-check' : undefined,
      avatar: { text: '2' }
    },
    { value: 'options', slot: 'options', avatar: { text: '3' } }
  )

  return items
})

/** The step to work on: the first one that is not done. */
const currentStep = computed(() => {
  if (!csv.value) return 'file'

  return mappingValid.value ? 'options' : 'map'
})

/** The line under the options: ready, or what still blocks the import. */
const readiness = computed(() => {
  if (ready.value) return `Ready to import ${summary.value}`

  if (!mappingValid.value) return 'Fix the column mapping above to continue'

  return 'Checking the file…'
})
</script>

<template>
  <UDashboardPanel id="contacts-import">
    <template #header>
      <UDashboardNavbar title="Import contacts">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            to="/contacts"
            aria-label="Back to contacts"
          />
        </template>
        <template #right>
          <span
            v-if="!importId && summary"
            class="hidden md:inline text-[13px] text-muted tabular-nums"
            >{{ summary }}</span
          >
          <UButton
            v-if="!importId"
            type="submit"
            form="import-form"
            label="Start import"
            icon="i-lucide-play"
            :disabled="!ready"
            :loading="starting"
          />
          <UButton
            v-else
            label="New import"
            icon="i-lucide-upload"
            variant="outline"
            @click="newImport"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="w-full max-w-4xl mx-auto flex flex-col gap-8">
        <ContactsImportProgress
          v-if="importId"
          :key="importId"
          :import-id="importId"
          @finished="onFinished"
          @reset="newImport"
        />

        <UTimeline
          v-else
          :model-value="currentStep"
          :items="steps"
          size="xs"
          color="neutral"
          :ui="{
            item: 'gap-4',
            indicator: 'ring ring-default',
            wrapper: 'min-w-0 mt-0 pb-10 group-last:pb-0',
            separator: 'my-1'
          }"
        >
          <!-- Step 1: file -->
          <template #file-wrapper>
            <section class="space-y-3" aria-labelledby="step-file">
              <div>
                <h2 id="step-file" class="text-base font-semibold text-highlighted">
                  Upload a CSV file
                </h2>
                <p class="text-sm text-muted">
                  First row with column names, one contact per row. Comma or semicolon separated,
                  UTF-8.
                </p>
              </div>

              <div
                v-if="csv && file"
                class="flex items-center gap-3 rounded-lg ring ring-default px-3 py-2.5"
              >
                <UAvatar icon="i-lucide-file-spreadsheet" size="md" class="rounded-md" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-highlighted truncate">
                    {{ file.name }}
                  </p>
                  <p class="text-xs text-muted tabular-nums" aria-live="polite">
                    {{ fileMeta }}
                  </p>
                </div>
                <UButton
                  label="Replace"
                  icon="i-lucide-replace"
                  variant="ghost"
                  size="sm"
                  @click="resetFile"
                />
              </div>

              <UFileUpload
                v-else
                v-model="file"
                accept=".csv,text/csv,application/vnd.ms-excel"
                icon="i-lucide-file-up"
                label="Drop your CSV file here"
                description="or click to browse · up to 50 MB"
                :preview="false"
                :disabled="parsing"
                class="w-full min-h-44"
                aria-label="CSV file"
                @reject="onReject"
              />

              <UAlert
                v-if="parseError"
                color="error"
                icon="i-lucide-circle-alert"
                :title="parseError"
                close
                @update:open="parseError = null"
              />

              <div v-if="previewRows.length" class="space-y-2">
                <p class="text-[13px] text-muted">
                  Preview of the first {{ previewRows.length }} rows
                </p>
                <UTable
                  :data="previewRows"
                  :columns="previewColumns"
                  caption="Preview of the file"
                  class="shrink-0"
                />
              </div>
            </section>
          </template>

          <!-- Step 2: mapping -->
          <template #map-wrapper>
            <section class="space-y-3" aria-labelledby="step-map">
              <div>
                <h2 id="step-map" class="text-base font-semibold text-highlighted">Map columns</h2>
                <p class="text-sm text-muted">
                  {{ mappedCount }} of {{ columns.length }} columns will be imported. Unknown
                  columns become custom attributes.
                </p>
              </div>

              <UTable
                :data="columns"
                :columns="mappingColumns"
                :get-row-id="(row: ColumnMapping) => row.column"
                :meta="{
                  class: { tr: (row) => (row.original.field === 'ignore' ? 'opacity-60' : '') }
                }"
                :ui="{ base: 'table-fixed min-w-[32rem]' }"
                caption="Column mapping"
                class="shrink-0"
              />

              <UAlert
                v-if="mappingIssue"
                color="error"
                icon="i-lucide-circle-alert"
                :title="mappingIssue"
                description="Change the Import as column to fix it."
              />
            </section>
          </template>

          <!-- Step 3: options -->
          <template #options-wrapper>
            <section class="space-y-4" aria-labelledby="step-options">
              <div>
                <h2 id="step-options" class="text-base font-semibold text-highlighted">Options</h2>
                <p class="text-sm text-muted">
                  Unsubscribed, bounced and complained contacts are never re-subscribed.
                </p>
              </div>

              <UForm
                id="import-form"
                :schema="optionsSchema"
                :state="options"
                class="space-y-4"
                @submit="start"
              >
                <UFormField
                  label="Add to list"
                  name="listId"
                  help="Imported contacts are subscribed to this list."
                >
                  <USelectMenu
                    v-model="options.listId"
                    :items="listItems"
                    value-key="value"
                    icon="i-lucide-list"
                    class="w-full sm:w-80"
                  />
                </UFormField>

                <UFormField
                  v-if="selectedList?.optIn === 'double'"
                  label="Subscription"
                  name="subscriptionStatus"
                  :help="`${selectedList.name} uses double opt-in.`"
                >
                  <URadioGroup
                    v-model="options.subscriptionStatus"
                    :items="subscriptionItems"
                    variant="table"
                  />
                </UFormField>

                <UFormField label="Existing contacts" name="mode">
                  <URadioGroup v-model="options.mode" :items="modeItems" variant="table" />
                </UFormField>
              </UForm>

              <UAlert
                :color="ready ? 'success' : 'neutral'"
                :icon="ready ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                :title="readiness"
                :description="ready ? 'Press Start import at the top to begin.' : undefined"
              />
            </section>
          </template>
        </UTimeline>

        <!-- Recent imports -->
        <section class="space-y-3" :class="{ 'ps-10': !importId }" aria-labelledby="recent-imports">
          <div class="flex items-center justify-between">
            <h2 id="recent-imports" class="text-base font-semibold text-highlighted">
              Recent imports
            </h2>
            <UButton
              icon="i-lucide-refresh-cw"
              variant="ghost"
              size="sm"
              aria-label="Refresh recent imports"
              :loading="recentStatus === 'pending'"
              @click="() => refreshRecent()"
            />
          </div>
          <ContactsImportHistory
            :imports="recent"
            :loading="recentStatus === 'pending' && !recent.length"
            :active-id="importId"
            @select="showImport"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
