<script setup lang="ts">
import type { SegmentMembershipStats } from '#shared/types/segments'

defineProps<{ stats: SegmentMembershipStats | null | undefined; syncing?: boolean }>()

const { number } = useFormat()
</script>

<template>
  <p v-if="syncing" class="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">
    <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
    <span>Syncing<span class="hidden md:inline"> members</span>…</span>
  </p>
  <p
    v-else-if="stats?.syncedAt"
    class="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted tabular-nums"
  >
    <span class="hidden md:inline">
      {{ number(stats.members) }} {{ stats.members === 1 ? 'member' : 'members' }}
    </span>
    <span class="hidden md:inline" aria-hidden="true">·</span>
    <UTooltip text="Changes in the last 7 days">
      <span>
        <span class="md:hidden">
          +{{ number(stats.enteredRecently) }} −{{ number(stats.exitedRecently) }}
        </span>
        <span class="hidden md:inline">
          {{ number(stats.enteredRecently) }} entered, {{ number(stats.exitedRecently) }} left this
          week
        </span>
      </span>
    </UTooltip>
    <span class="hidden md:inline" aria-hidden="true">·</span>
    <span class="hidden md:inline-flex gap-1">Synced <TimeAgo :date="stats.syncedAt" /></span>
  </p>
  <p v-else-if="stats" class="hidden md:block text-[13px] text-muted">
    Membership history starts after the first sync
  </p>
</template>
