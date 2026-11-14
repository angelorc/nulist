<script setup lang="ts">
import { parseDate, toCalendarDate, today } from '@internationalized/date'
import type { CalendarDate, DateValue } from '@internationalized/date'
import { breakpointsTailwind } from '@vueuse/core'
import { format, parseISO } from 'date-fns'
import type { ButtonProps, TooltipProps } from '@nuxt/ui'
import { LOG_PERIODS, MAX_RANGE_DAYS } from '#shared/schemas/logs'
import type { LogPeriod } from '#shared/types/logs'
import type { DateRangeValue } from '~/utils/logLinks'

interface CalendarRange {
  start: DateValue | undefined
  end: DateValue | undefined
}

const props = withDefaults(
  defineProps<{
    presets?: LogPeriod[]
    anyTime?: boolean
    defaultPeriod?: LogPeriod
    size?: ButtonProps['size']
    align?: 'start' | 'center' | 'end'
    tooltip?: Pick<TooltipProps, 'text' | 'kbds'>
  }>(),
  {
    presets: () => [...LOG_PERIODS],
    anyTime: false,
    defaultPeriod: undefined,
    size: undefined,
    align: 'end',
    tooltip: undefined
  }
)

const model = defineModel<DateRangeValue>({ default: () => ({}) })

const PERIOD_LABEL: Record<LogPeriod, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days'
}

const PERIOD_DAYS: Record<LogPeriod, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }

const open = ref(false)
const draft = shallowRef<CalendarRange>({ start: undefined, end: undefined })
const maxDate = shallowRef<CalendarDate>()
const placeholder = shallowRef<DateValue>()

const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('sm')
const months = computed(() => (isDesktop.value ? 2 : 1))

const isCustom = computed(() => Boolean(model.value.from || model.value.to))

const activePeriod = computed<LogPeriod | undefined>(() => {
  if (isCustom.value) {
    return undefined
  }

  return model.value.period ?? (props.anyTime ? undefined : props.defaultPeriod)
})

const isAnyTime = computed(() => props.anyTime && !isCustom.value && !model.value.period)

const label = computed(() => {
  if (isCustom.value) {
    return customLabel(model.value.from, model.value.to)
  }

  return activePeriod.value ? PERIOD_LABEL[activePeriod.value] : 'Any time'
})

function day(value: string) {
  return parseISO(value)
}

function customLabel(from: string | undefined, to: string | undefined) {
  if (from && to) {
    const [start, end] = from <= to ? [day(from), day(to)] : [day(to), day(from)]

    if (start.getTime() === end.getTime()) {
      return format(start, 'd MMM yyyy')
    }

    if (start.getFullYear() !== end.getFullYear()) {
      return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`
    }

    const head = start.getMonth() === end.getMonth() ? format(start, 'd') : format(start, 'd MMM')

    return `${head} – ${format(end, 'd MMM yyyy')}`
  }

  if (from) {
    return `Since ${format(day(from), 'd MMM yyyy')}`
  }

  return to ? `Until ${format(day(to), 'd MMM yyyy')}` : 'Any time'
}

function toDate(value: string | undefined): CalendarDate | undefined {
  if (!value) {
    return undefined
  }

  try {
    return parseDate(value)
  } catch {
    return undefined
  }
}

function initialRange(now: CalendarDate): CalendarRange {
  if (isCustom.value) {
    return { start: toDate(model.value.from), end: toDate(model.value.to) }
  }

  if (activePeriod.value) {
    return { start: now.subtract({ days: PERIOD_DAYS[activePeriod.value] }), end: now }
  }

  return { start: undefined, end: undefined }
}

function initialPlaceholder(range: CalendarRange, now: CalendarDate): DateValue {
  const first = (range.end ?? now).subtract({ months: months.value - 1 })

  return range.start && range.start.compare(first) < 0 ? range.start : first
}

watch(open, (isOpen) => {
  if (!isOpen) {
    return
  }

  const now = today('UTC')
  const range = initialRange(now)

  maxDate.value = now
  draft.value = range
  placeholder.value = initialPlaceholder(range, now)
})

function selectPeriod(period: LogPeriod | undefined) {
  model.value = { period, from: undefined, to: undefined }
  open.value = false
}

function onCalendar(value: CalendarRange | null | undefined) {
  draft.value = { start: value?.start, end: value?.end }

  if (!value?.start || !value.end) {
    return
  }

  model.value = {
    period: undefined,
    from: toCalendarDate(value.start).toString(),
    to: toCalendarDate(value.end).toString()
  }
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align }">
    <UTooltip v-bind="tooltip" :disabled="!tooltip || open">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-calendar"
        trailing-icon="i-lucide-chevron-down"
        :size="size"
        :label="label"
        :aria-label="`Date range: ${label}`"
        class="data-[state=open]:bg-elevated"
        :ui="{ label: 'tabular-nums', trailingIcon: 'text-dimmed' }"
      />
    </UTooltip>

    <template #content>
      <div class="flex flex-col divide-y divide-default sm:flex-row sm:divide-x sm:divide-y-0">
        <div
          role="group"
          aria-label="Presets"
          class="flex flex-wrap gap-1 p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:gap-0 sm:px-0 sm:py-2"
        >
          <UButton
            v-for="period in presets"
            :key="period"
            :label="PERIOD_LABEL[period]"
            color="neutral"
            variant="ghost"
            size="sm"
            class="sm:rounded-none sm:px-4"
            :class="activePeriod === period ? 'bg-elevated text-highlighted' : 'text-muted'"
            :aria-pressed="activePeriod === period"
            @click="selectPeriod(period)"
          />
          <UButton
            v-if="anyTime"
            label="Any time"
            color="neutral"
            variant="ghost"
            size="sm"
            class="sm:rounded-none sm:px-4"
            :class="isAnyTime ? 'bg-elevated text-highlighted' : 'text-muted'"
            :aria-pressed="isAnyTime"
            @click="selectPeriod(undefined)"
          />
        </div>

        <UCalendar
          :model-value="draft"
          :placeholder="placeholder"
          :number-of-months="months"
          :max-value="maxDate"
          :maximum-days="MAX_RANGE_DAYS"
          range
          class="p-2"
          :ui="{ cellTrigger: 'data-outside-view:invisible' }"
          @update:model-value="onCalendar"
        />
      </div>
    </template>
  </UPopover>
</template>
