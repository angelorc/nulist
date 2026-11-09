<script setup lang="ts">
import type { WebhookEventType } from '#shared/utils/webhook-events'

/**
 * Event subscription editor: "all events" (stored as an empty list, includes
 * future event types) or an explicit selection grouped by resource.
 */
const all = defineModel<boolean>('all', { required: true })
const events = defineModel<WebhookEventType[]>('events', { required: true })

defineProps<{ disabled?: boolean }>()

const GROUP_LABELS = new Map([
  ['email', 'Email'],
  ['contact', 'Contacts'],
  ['broadcast', 'Broadcasts']
])

const groups = computed(() => {
  const map = new Map<string, { type: WebhookEventType; description: string }[]>()

  for (const event of WEBHOOK_EVENTS) {
    const key = event.type.split('.')[0]!
    map.set(key, [...(map.get(key) ?? []), { type: event.type, description: event.description }])
  }

  return [...map.entries()].map(([key, items]) => ({
    key,
    label: GROUP_LABELS.get(key) ?? key,
    items
  }))
})

const modeItems = [
  {
    label: 'All events',
    value: 'all',
    description: 'Includes event types added in future versions.'
  },
  { label: 'Selected events', value: 'selected', description: 'Only the events you pick below.' }
]

const mode = computed({
  get: () => (all.value ? 'all' : 'selected'),
  set: (value: string) => {
    all.value = value === 'all'
  }
})

function groupState(items: { type: WebhookEventType }[]): boolean | 'indeterminate' {
  const selected = items.filter((i) => events.value.includes(i.type)).length

  return selected === 0 ? false : selected === items.length ? true : 'indeterminate'
}

function toggleGroup(items: { type: WebhookEventType }[], value: boolean | 'indeterminate') {
  const types = items.map((i) => i.type)
  events.value =
    value === true
      ? [...new Set([...events.value, ...types])]
      : events.value.filter((t) => !types.includes(t))
}

function toggle(type: WebhookEventType, value: boolean | 'indeterminate') {
  events.value = value === true ? [...events.value, type] : events.value.filter((t) => t !== type)
}

function selectAll() {
  events.value = WEBHOOK_EVENTS.map((e) => e.type)
}

function selectNone() {
  events.value = []
}
</script>

<template>
  <div class="space-y-3">
    <URadioGroup v-model="mode" :items="modeItems" variant="table" size="sm" :disabled="disabled" />

    <div v-if="!all" class="rounded-md ring ring-default divide-y divide-default">
      <div class="flex items-center justify-between gap-2 px-3 py-2 bg-elevated/50 rounded-t-md">
        <p class="text-xs text-muted tabular-nums">
          {{ events.length }} of {{ WEBHOOK_EVENTS.length }} selected
        </p>
        <div class="flex items-center gap-1">
          <UButton
            label="Select all"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="disabled"
            @click="selectAll"
          />
          <UButton
            label="Clear"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="disabled || !events.length"
            @click="selectNone"
          />
        </div>
      </div>

      <fieldset v-for="group in groups" :key="group.key" class="px-3 py-2.5" :disabled="disabled">
        <legend class="sr-only">
          {{ group.label }}
        </legend>
        <UCheckbox
          :model-value="groupState(group.items)"
          :label="group.label"
          size="sm"
          :ui="{ label: 'text-[13px] font-medium text-highlighted' }"
          :disabled="disabled"
          @update:model-value="(v: boolean | 'indeterminate') => toggleGroup(group.items, v)"
        />
        <div class="mt-2 ms-6 grid gap-2">
          <UCheckbox
            v-for="item in group.items"
            :key="item.type"
            :model-value="events.includes(item.type)"
            size="sm"
            :disabled="disabled"
            :ui="{
              label: 'font-mono text-xs text-default font-normal',
              description: 'text-xs text-muted'
            }"
            :label="item.type"
            :description="item.description"
            @update:model-value="(v: boolean | 'indeterminate') => toggle(item.type, v)"
          />
        </div>
      </fieldset>
    </div>
  </div>
</template>
