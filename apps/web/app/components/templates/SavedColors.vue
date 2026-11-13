<script setup lang="ts">
/**
 * The "Saved colors" part of the visual editor's colour pickers: the
 * organization's saved colours, and a button that saves the picker's colour
 * (or removes it when it is saved already).
 */
const props = defineProps<{
  colors: readonly string[]
  /** The open picker's colour; null while its field is empty or transparent. */
  current: string | null
  limit: number
}>()

const emit = defineEmits<{
  apply: [color: string]
  toggle: [color: string]
}>()

const saved = computed(() => props.current !== null && props.colors.includes(props.current))
const full = computed(() => !saved.value && props.colors.length >= props.limit)

const label = computed(() => {
  if (!props.colors.length) return 'Save colors you use often'

  return full.value ? `Saved colors (${props.limit} max)` : 'Saved colors'
})

function toggle() {
  if (props.current) emit('toggle', props.current)
}
</script>

<template>
  <div class="w-0 min-w-full mt-3 pt-3 border-t border-default space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-muted">{{ label }}</span>
      <!-- No loading state: it would disable the button and drop keyboard focus mid-change. -->
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="saved ? 'i-lucide-star-off' : 'i-lucide-star'"
        :label="saved ? 'Remove' : 'Save'"
        :aria-label="
          current ? (saved ? `Remove ${current} from saved colors` : `Save ${current}`) : undefined
        "
        :disabled="!current || full"
        @click="toggle"
      />
    </div>

    <div v-if="colors.length" role="group" aria-label="Saved colors" class="flex flex-wrap gap-1.5">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        :title="color"
        :aria-label="color"
        :aria-pressed="color === current"
        class="size-6 shrink-0 cursor-pointer rounded-sm border border-default outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
        :class="
          color === current
            ? 'ring-2 ring-primary ring-offset-1 ring-offset-(--ui-bg)'
            : 'hover:border-accented'
        "
        :style="{ backgroundColor: color }"
        @click="emit('apply', color)"
      />
    </div>
  </div>
</template>
