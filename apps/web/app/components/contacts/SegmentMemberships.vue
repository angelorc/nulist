<script setup lang="ts">
import type { ContactDetail, ContactSegmentMembership } from '#shared/types/contacts'

const props = defineProps<{ contact: ContactDetail }>()

const url = computed<string>(() => `/api/contacts/${props.contact.id}/segments`)

const {
  data: segments,
  status,
  error,
  refresh
} = useFetch<ContactSegmentMembership[]>(url, {
  key: `contact-segments-${props.contact.id}`,
  lazy: true,
  server: false,
  default: () => [],
  watch: [() => props.contact]
})

const loading = computed(() => status.value === 'idle' || status.value === 'pending')

const { date } = useFormat()
</script>

<template>
  <section aria-labelledby="contact-segments">
    <h3 id="contact-segments" class="text-xs font-medium text-muted mb-2">Segments</h3>
    <div v-if="loading && !segments.length" class="flex flex-wrap gap-1.5" aria-busy="true">
      <USkeleton v-for="n in 2" :key="n" class="h-6 w-24 rounded-md" />
    </div>
    <EmptyState
      v-else-if="error"
      variant="error"
      title="Segments could not be loaded"
      :description="apiErrorMessage(error)"
      compact
    >
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        variant="outline"
        :loading="loading"
        @click="() => refresh()"
      />
    </EmptyState>
    <ul v-else-if="segments.length" class="flex flex-wrap gap-1.5">
      <li v-for="segment in segments" :key="segment.id" class="max-w-full">
        <ULink :to="`/segments/${segment.id}`" class="block max-w-full">
          <UBadge
            :label="segment.name"
            icon="i-lucide-filter"
            color="neutral"
            variant="outline"
            class="max-w-full hover:bg-elevated"
            :ui="{ leadingIcon: 'text-muted', label: 'truncate' }"
          >
            <template v-if="segment.memberSince" #trailing>
              <span class="shrink-0 text-muted tabular-nums">
                since {{ date(segment.memberSince) }}
              </span>
            </template>
          </UBadge>
        </ULink>
      </li>
    </ul>
    <p v-else class="text-[13px] text-muted">Not in any segment.</p>
  </section>
</template>
