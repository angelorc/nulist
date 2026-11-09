<script setup lang="ts">
import type { IdentityStatus } from '#shared/schemas/domains'

/** SES verification status as a StatusBadge (status → DESIGN.md color mapping). */
const props = defineProps<{ status: IdentityStatus; prefix?: string }>()

const DISPLAY: Record<IdentityStatus, { status: string; label: string }> = {
  verified: { status: 'success', label: 'Verified' },
  pending: { status: 'pending', label: 'Pending' },
  failed: { status: 'failed', label: 'Failed' },
  temporary_failure: { status: 'delayed', label: 'Retrying' },
  not_started: { status: 'draft', label: 'Not started' }
}

const display = computed(() => DISPLAY[props.status])
</script>

<template>
  <StatusBadge
    :status="display.status"
    :label="prefix ? `${prefix} ${display.label.toLowerCase()}` : display.label"
  />
</template>
