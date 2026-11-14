<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import {
  IDEMPOTENCY_WINDOW_HOURS,
  MAX_BATCH_SIZE,
  MAX_SCHEDULE_DAYS
} from '#shared/schemas/transactional'
import type { TransactionalTemplateItem } from '#shared/schemas/transactional'

type Language = 'curl' | 'node' | 'python'

const props = defineProps<{ templates: TransactionalTemplateItem[]; siteUrl: string }>()

const LANGUAGES = [
  { label: 'cURL', value: 'curl', icon: 'i-lucide-terminal' },
  { label: 'Node.js', value: 'node', icon: 'i-lucide-hexagon' },
  { label: 'Python', value: 'python', icon: 'i-lucide-file-code' }
] satisfies TabsItem[]

const stored = useLocalStorage<Language>('nulist:quickstart-language', 'curl', {
  initOnMounted: true
})

const language = computed<Language>({
  get: () => (LANGUAGES.some((l) => l.value === stored.value) ? stored.value : 'curl'),
  set: (value) => {
    stored.value = value
  }
})

const slugs = computed(() =>
  props.templates.flatMap((t) =>
    t.slug ? [{ label: t.name, value: t.slug, description: t.slug }] : []
  )
)

const selectedSlug = ref<string | undefined>(slugs.value[0]?.value)

watch(slugs, (items) => {
  if (!items.some((i) => i.value === selectedSlug.value)) selectedSlug.value = items[0]?.value
})

const endpoint = computed(() => `${props.siteUrl.replace(/\/+$/, '')}/api/v1/emails`)
const slug = computed(() => selectedSlug.value ?? 'welcome')

/** Builds copy-ready requests for POST /api/v1/emails in each language. */
const snippets = computed<Record<Language, string>>(() => ({
  curl: [
    `curl -X POST ${endpoint.value} \\`,
    `  -H "Authorization: Bearer $NULIST_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: signup-ada-2026-05-01" \\`,
    `  -d '{`,
    `    "to": "ada@example.com",`,
    `    "template": "${slug.value}",`,
    `    "data": { "name": "Ada", "plan": "Pro" }`,
    `  }'`
  ].join('\n'),
  node: [
    `const response = await fetch('${endpoint.value}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    'Authorization': \`Bearer \${process.env.NULIST_API_KEY}\`,`,
    `    'Content-Type': 'application/json',`,
    `    // Retrying with the same key never sends twice (${IDEMPOTENCY_WINDOW_HOURS} hours).`,
    `    'Idempotency-Key': \`signup-\${user.id}\``,
    `  },`,
    `  body: JSON.stringify({`,
    `    to: user.email,`,
    `    template: '${slug.value}',`,
    `    data: { name: user.name, plan: 'Pro' }`,
    `  })`,
    `})`,
    ``,
    `if (!response.ok) {`,
    `  const { error } = await response.json()`,
    `  throw new Error(\`nulist: \${error.code}: \${error.message}\`)`,
    `}`,
    `const email = await response.json() // { id, status: 'queued', ... }`
  ].join('\n'),
  python: [
    `import os`,
    `import requests`,
    ``,
    `response = requests.post(`,
    `    "${endpoint.value}",`,
    `    headers={`,
    `        "Authorization": f"Bearer {os.environ['NULIST_API_KEY']}",`,
    `        # Retrying with the same key never sends twice (${IDEMPOTENCY_WINDOW_HOURS} hours).`,
    `        "Idempotency-Key": f"signup-{user.id}",`,
    `    },`,
    `    json={`,
    `        "to": user.email,`,
    `        "template": "${slug.value}",`,
    `        "data": {"name": user.name, "plan": "Pro"},`,
    `    },`,
    `    timeout=10,`,
    `)`,
    `response.raise_for_status()`,
    `email = response.json()  # {"id": "...", "status": "queued", ...}`
  ].join('\n')
}))

const currentLabel = computed(
  () => LANGUAGES.find((l) => l.value === language.value)?.label ?? 'code'
)

const notes = [
  {
    term: 'Template or HTML',
    detail:
      'Pass a transactional template by slug or id with data for {{ data.<key> }}, or send subject and html (plus optional text) directly. Liquid works in both.'
  },
  {
    term: 'Idempotency-Key',
    detail: `The same key and body within ${IDEMPOTENCY_WINDOW_HOURS} hours returns the original email with Idempotent-Replayed: true. A different body with a used key is rejected with 409.`
  },
  {
    term: 'Scheduling',
    detail: `Add scheduledAt (ISO 8601, up to ${MAX_SCHEDULE_DAYS} days ahead). Cancel with POST /api/v1/emails/{id}/cancel before it goes out.`
  },
  {
    term: 'Batches',
    detail: `POST /api/v1/emails/batch takes up to ${MAX_BATCH_SIZE} emails. The batch is validated as a whole: either every email is queued or none is.`
  },
  {
    term: 'Errors and limits',
    detail:
      'Errors look like { "error": { "code", "message" } }. Every response carries RateLimit headers; 429 responses add Retry-After.'
  }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <UTabs
        v-model="language"
        :items="LANGUAGES"
        :content="false"
        variant="link"
        size="sm"
        aria-label="Code language"
      />
      <UFormField
        v-if="slugs.length"
        label="Template"
        name="template"
        orientation="horizontal"
        size="sm"
        :ui="{ root: 'items-center', label: 'font-normal text-muted' }"
      >
        <USelect v-model="selectedSlug" :items="slugs" size="sm" class="w-48" />
      </UFormField>
    </div>

    <CodeBlock
      :code="snippets[language]"
      :label="`${currentLabel} example`"
      :lang="({ curl: 'shell', node: 'javascript', python: 'python' } as const)[language]"
      line-numbers
    />

    <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
      <div v-for="note in notes" :key="note.term" class="min-w-0">
        <dt class="text-[13px] font-medium text-highlighted">
          {{ note.term }}
        </dt>
        <dd class="text-[13px] text-muted mt-0.5">
          {{ note.detail }}
        </dd>
      </div>
    </dl>
  </div>
</template>
