<script setup lang="ts">
import { segmentRulesSchema } from '#shared/schemas/segments'
import type { SegmentRules } from '#shared/types/domain'

/**
 * Live, debounced (400ms) count of contacts matching unsaved rules,
 * plus a preview of the five most recent matches.
 */
const props = defineProps<{ rules: SegmentRules }>()

interface PreviewContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: string
}

const { number } = useFormat()

const parsed = computed(() => segmentRulesSchema.safeParse(props.rules))
const signature = computed(() => (parsed.value.success ? JSON.stringify(parsed.value.data) : null))

const count = ref<number | null>(null)
const preview = ref<PreviewContact[]>([])
const pending = ref(false)
const failed = ref(false)
let requestId = 0

async function load() {
  const result = parsed.value

  if (!result.success) return
  const current = ++requestId
  pending.value = true
  failed.value = false

  try {
    const response = await $fetch<{ count: number; preview: PreviewContact[] }>(
      '/api/segments/count',
      { method: 'POST', body: { rules: result.data } }
    )

    if (current !== requestId) return
    count.value = response.count
    preview.value = response.preview
  } catch {
    if (current === requestId) failed.value = true
  } finally {
    if (current === requestId) pending.value = false
  }
}

const debouncedLoad = useDebounceFn(load, 400)

watch(signature, (value) => {
  // Invalidate any in-flight request: its rules are outdated.
  requestId++

  if (value === null) {
    pending.value = false

    return
  }

  pending.value = true
  debouncedLoad()
})

onMounted(() => {
  if (signature.value !== null) load()
})

const state = computed<'invalid' | 'error' | 'loading' | 'ready'>(() => {
  if (!parsed.value.success) return 'invalid'

  if (failed.value) return 'error'

  if (count.value === null) return 'loading'

  return 'ready'
})

function displayName(contact: PreviewContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ')
}
</script>

<template>
  <section class="rounded-lg ring ring-default" aria-label="Matching contacts">
    <div class="p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="text-[13px] text-muted">Matching contacts</p>
        <UIcon
          v-if="pending && state !== 'invalid'"
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin text-muted"
          aria-hidden="true"
        />
      </div>

      <div aria-live="polite" aria-atomic="true" class="mt-1.5">
        <template v-if="state === 'invalid'">
          <p class="text-[28px] leading-8 font-semibold tracking-tight text-dimmed tabular-nums">
            —
          </p>
          <p class="mt-1 text-xs text-muted">Complete every condition to see a live count.</p>
        </template>
        <template v-else-if="state === 'error'">
          <p class="text-sm text-highlighted">Couldn't count contacts.</p>
          <UButton
            label="Retry"
            icon="i-lucide-rotate-cw"
            variant="outline"
            size="sm"
            class="mt-2"
            @click="load"
          />
        </template>
        <div v-else-if="state === 'loading'" aria-busy="true">
          <USkeleton class="h-8 w-28" />
          <USkeleton class="mt-2 h-3 w-40" />
        </div>
        <template v-else>
          <p
            class="flex items-baseline gap-1.5"
            :class="pending && 'opacity-60 transition-opacity'"
          >
            <span
              class="text-[28px] leading-8 font-semibold tracking-tight text-highlighted tabular-nums"
              >≈ {{ number(count) }}</span
            >
            <span class="text-sm text-muted">{{ count === 1 ? 'contact' : 'contacts' }}</span>
          </p>
          <p class="mt-1 text-xs text-muted">
            Live count across every status. Broadcasts only reach active, non-suppressed contacts.
          </p>
        </template>
      </div>
    </div>

    <template v-if="state === 'ready' || (state === 'loading' && pending)">
      <USeparator />
      <div class="p-2">
        <p class="px-2 pt-1 pb-2 text-xs font-medium text-muted">Preview</p>
        <ul v-if="state === 'loading'" class="space-y-1 px-2 pb-2">
          <li v-for="i in 3" :key="i" class="py-1.5">
            <USkeleton class="h-3.5 w-full" />
          </li>
        </ul>
        <ul v-else-if="preview.length" :class="pending && 'opacity-60 transition-opacity'">
          <li v-for="contact in preview" :key="contact.id">
            <NuxtLink
              :to="`/contacts/${contact.id}`"
              class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated/60 focus-visible:outline-2 focus-visible:outline-primary transition-colors"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] font-medium text-highlighted">
                  {{ contact.email }}
                </p>
                <p v-if="displayName(contact)" class="truncate text-xs text-muted">
                  {{ displayName(contact) }}
                </p>
              </div>
              <StatusBadge :status="contact.status" size="xs" />
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="px-2 pb-2 text-[13px] text-muted">
          No contacts match these conditions yet.
        </p>
      </div>
    </template>
  </section>
</template>
