<script setup lang="ts">
/**
 * Footer under a list (DESIGN.md §4): the count (and selection) on the left, UPagination on the
 * right once there is more than one page. Hidden while there is nothing to count.
 *
 * <TableFooter v-model:page="page" :total="total" :page-size="pageSize" />
 * <TableFooter :total="segments.length" :page-size="segments.length" noun="segment" />
 */
const page = defineModel<number>('page', { default: 1 })

const props = withDefaults(
  defineProps<{
    total: number
    pageSize: number
    selected?: number
    /** What is counted, singular. */
    noun?: string
    /** Plural of `noun` when it is not `noun` + "s". */
    nounPlural?: string
  }>(),
  { selected: 0, noun: 'result', nounPlural: undefined }
)

const { number } = useFormat()

const countLabel = computed(() => {
  const noun = props.total === 1 ? props.noun : (props.nounPlural ?? `${props.noun}s`)

  return `${number(props.total)} ${noun}`
})
</script>

<template>
  <div
    v-if="total > 0 || selected > 0"
    class="flex items-center justify-between gap-3 border-t border-default pt-3 mt-auto"
  >
    <p class="text-[13px] text-muted tabular-nums" aria-live="polite">
      <template v-if="selected"> {{ number(selected) }} selected · </template>
      {{ countLabel }}
    </p>
    <UPagination
      v-if="total > pageSize"
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      size="sm"
    />
  </div>
</template>
