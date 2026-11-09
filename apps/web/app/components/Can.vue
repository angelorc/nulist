<script setup lang="ts">
import type { VNode } from 'vue'
import type { PermissionRequest } from '#shared/auth/permissions'

/**
 * Gates content on what the member may do in the active organization.
 *
 * Default: renders the default slot when allowed, the `denied` slot otherwise.
 *
 * <Can :permission="{ contact: ['import'] }"><UButton label="Import" /></Can>
 *
 * `explain` (the screen's primary action, DESIGN.md §5): always renders the default slot with
 * `allowed`, and when denied wraps it in a focusable tooltip saying why (`explain` may be the
 * sentence; it defaults to "You don't have permission").
 *
 * <Can v-slot="{ allowed }" :permission="{ broadcast: ['create'] }" explain>
 *   <UButton label="New broadcast" color="neutral" :disabled="!allowed" />
 * </Can>
 */
const props = withDefaults(
  defineProps<{
    permission: PermissionRequest
    explain?: boolean | string
  }>(),
  { explain: false }
)

defineSlots<{
  default?: (props: { allowed: boolean }) => VNode[]
  denied?: () => VNode[]
}>()

const DEFAULT_REASON = "You don't have permission"

const { can } = useOrganization()
const allowed = computed(() => can(props.permission))

const reason = computed(() =>
  props.explain === true || props.explain === '' ? DEFAULT_REASON : props.explain
)
</script>

<template>
  <slot v-if="allowed" :allowed="true" />
  <UTooltip v-else-if="reason" :text="reason">
    <span class="inline-flex" tabindex="0">
      <slot :allowed="false" />
    </span>
  </UTooltip>
  <slot v-else name="denied" />
</template>
