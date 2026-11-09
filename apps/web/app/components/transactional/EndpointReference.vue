<script setup lang="ts">
import type { BadgeProps, TableColumn } from '@nuxt/ui'
import { V1_ENDPOINTS, scopeCovering } from '#shared/schemas/v1'
import type { V1Endpoint } from '#shared/schemas/v1'
import type { ApiKeyScope } from '#shared/types/domain'

/**
 * Badge of the least privileged key scope that can call an endpoint: a neutral outline label,
 * amber when it needs a full-access key (DESIGN.md §5 "Badges and status").
 */
const SCOPE_BADGES = {
  sending: { label: 'Sending', color: 'neutral', variant: 'outline' },
  full: { label: 'Full access', color: 'warning', variant: 'subtle' }
} as const satisfies Record<ApiKeyScope, Pick<BadgeProps, 'label' | 'color' | 'variant'>>

const endpoints: V1Endpoint[] = [...V1_ENDPOINTS]

const UBadge = resolveComponent('UBadge')
const LogsMethodBadge = resolveComponent('LogsMethodBadge')

const columns: TableColumn<V1Endpoint>[] = [
  {
    accessorKey: 'path',
    header: 'Endpoint',
    meta: { class: { th: 'md:w-[23rem]', td: 'md:w-[23rem] whitespace-normal' } },
    cell: ({ row }) =>
      h('div', { class: 'flex items-start gap-2 min-w-0' }, [
        h(LogsMethodBadge, { method: row.original.method, class: 'shrink-0' }),
        h(
          'code',
          { class: 'font-mono text-xs leading-5 text-highlighted break-all' },
          row.original.path
        )
      ])
  },
  {
    id: 'scope',
    header: 'Key',
    meta: { class: { th: 'w-28', td: 'w-28' } },
    cell: ({ row }) => h(UBadge, SCOPE_BADGES[scopeCovering(row.original.permission) ?? 'full'])
  },
  {
    accessorKey: 'description',
    header: 'Description',
    meta: {
      class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell text-muted whitespace-normal' }
    }
  }
]
</script>

<template>
  <UTable :data="endpoints" :columns="columns" :ui="tableUi" />
</template>
