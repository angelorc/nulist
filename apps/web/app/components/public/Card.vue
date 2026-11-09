<script setup lang="ts">
import type { VNode } from 'vue'
import { NEUTRAL_PUBLIC_BRAND } from '#shared/schemas/public'
import type { PublicBrand } from '#shared/schemas/public'

/**
 * Shell for recipient-facing pages (confirm, preferences, subscribe): the
 * organization's brand mark above a single UCard whose title is the page's
 * heading, and the organization's name and postal address below it.
 * `brand` comes from the page's own payload (every public endpoint embeds the
 * branding of the organization behind the link); without one (invalid link,
 * network error) the neutral brand is shown. `loading` turns the header into
 * skeletons shaped like it (the title stays when it is known).
 *
 * <PublicCard title="Email preferences" :brand>
 *   <template #description>Choose what you receive.</template>
 *   …
 *   <template #footer><UButton label="Save" /></template>
 * </PublicCard>
 */
const props = defineProps<{
  title?: string
  description?: string
  brand?: PublicBrand | null
  loading?: boolean
}>()

const slots = defineSlots<{
  default?: () => VNode[]
  description?: () => VNode[]
  footer?: () => VNode[]
  /** Content between the card and the brand footer (a second section, a note). */
  after?: () => VNode[]
}>()

const brand = computed(() => props.brand ?? NEUTRAL_PUBLIC_BRAND)
const name = computed(() => brand.value.companyName || brand.value.appName)
const initial = computed(() => name.value.trim().charAt(0).toUpperCase() || 'M')

const headingId = useId()

const hasHeader = computed(() => Boolean(props.title || props.loading))

const hasDescription = computed(() =>
  Boolean(props.description || slots.description || props.loading)
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-center gap-2.5">
      <UAvatar
        :src="brand.logo ?? undefined"
        :text="initial"
        size="md"
        aria-hidden="true"
        :ui="{
          root: 'rounded-md',
          image: 'object-contain',
          fallback:
            'size-full inline-flex items-center justify-center rounded-[inherit] bg-inverted text-inverted text-[13px] font-semibold'
        }"
      />
      <span class="truncate text-sm font-semibold text-highlighted">{{ name }}</span>
    </div>

    <UCard
      as="section"
      :aria-labelledby="title ? headingId : undefined"
      :aria-busy="loading ? 'true' : undefined"
      :ui="{ title: 'text-lg', description: 'text-pretty' }"
    >
      <template v-if="hasHeader" #title>
        <h1 v-if="title" :id="headingId">{{ title }}</h1>
        <USkeleton v-else class="h-6 my-0.5 w-48 max-w-full" />
      </template>

      <template v-if="hasHeader && hasDescription" #description>
        <USkeleton v-if="loading" class="h-4 mt-1.5 w-64 max-w-full" />
        <slot v-else name="description">
          {{ description }}
        </slot>
      </template>

      <template v-if="slots.default" #default>
        <slot />
      </template>

      <template v-if="slots.footer" #footer>
        <slot name="footer" />
      </template>
    </UCard>

    <slot name="after" />

    <footer class="text-center text-xs text-muted text-pretty">
      <address class="not-italic">
        {{ name }}<template v-if="brand.companyAddress"> · {{ brand.companyAddress }}</template>
      </address>
    </footer>
  </div>
</template>
