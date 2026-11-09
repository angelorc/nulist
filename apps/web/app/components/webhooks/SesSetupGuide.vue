<script setup lang="ts">
import type { TimelineItem } from '@nuxt/ui'

/**
 * How to connect Amazon SES to this instance: the copyable SNS endpoint URL and the setup
 * steps, collapsed once events arrive (`defaultOpen`).
 */
const props = defineProps<{ inboundUrl: string; defaultOpen?: boolean }>()

const open = ref(props.defaultOpen ?? false)

const eventTypes = [
  'Deliveries',
  'Hard bounces',
  'Complaints',
  'Rejects',
  'Delivery delays',
  'Opens',
  'Clicks',
  'Rendering failures'
]

const steps = [
  {
    avatar: { text: '1' },
    title: 'Create a configuration set',
    description:
      'In the SES console, open Configuration sets and create one for mlist (or reuse yours). Enter its name in Settings → Sending so every email is tagged with it.'
  },
  {
    avatar: { text: '2' },
    title: 'Add an SNS event destination',
    description:
      'In the configuration set, add an event destination of type Amazon SNS and select a new or existing topic. Enable the event types listed below; Send events are not needed.',
    slot: 'destination' as const
  },
  {
    avatar: { text: '3' },
    title: 'Subscribe this endpoint',
    description:
      'In Amazon SNS, open the topic and create a subscription with protocol HTTPS and the endpoint URL above. mlist confirms the subscription automatically.'
  },
  {
    avatar: { text: '4' },
    title: 'Enable signature version 2',
    description:
      'Edit the topic and set the signature version to 2 (SHA256). mlist verifies the signature and certificate of every message and rejects anything else.'
  }
] satisfies TimelineItem[]
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Endpoint URL" class="max-w-2xl">
      <UInput
        :model-value="inboundUrl"
        readonly
        size="sm"
        class="w-full"
        :ui="{ base: 'font-mono text-xs pe-9', trailing: 'pe-1' }"
      >
        <template #trailing>
          <CopyButton :value="inboundUrl" label="endpoint URL" />
        </template>
      </UInput>

      <template #help>
        Must be reachable from the internet over HTTPS. To accept only your topics, set
        <code class="font-mono">NUXT_SNS_TOPIC_ARNS</code> to a comma-separated list of topic ARNs.
      </template>
    </UFormField>

    <UCollapsible v-model:open="open" :ui="{ content: 'pt-3' }">
      <UButton
        :label="open ? 'Hide setup steps' : 'Show setup steps'"
        :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        variant="link"
        size="sm"
        class="px-0"
      />
      <template #content>
        <UTimeline
          :items="steps"
          size="2xs"
          color="neutral"
          :ui="{
            separator: 'bg-accented',
            indicator: 'ring ring-default',
            title: 'text-[13px]',
            description: 'text-[13px]'
          }"
        >
          <template #destination-description="{ item }">
            <p>{{ item.description }}</p>
            <div class="flex flex-wrap gap-1 pt-1.5">
              <UBadge v-for="type in eventTypes" :key="type" :label="type" variant="outline" />
            </div>
          </template>
        </UTimeline>
      </template>
    </UCollapsible>
  </div>
</template>
