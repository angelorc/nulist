<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { DnsRecord, DnsRecordPurpose } from '#shared/schemas/domains'

/** Records to publish at the DNS provider, each value copyable. */
const props = defineProps<{ records: DnsRecord[]; domain: string }>()

const PURPOSE: Record<DnsRecordPurpose, string> = {
  dkim: 'DKIM',
  spf: 'SPF',
  dmarc: 'DMARC',
  mail_from: 'MAIL FROM'
}

function displayValue(record: DnsRecord) {
  return record.priority !== undefined ? `${record.priority} ${record.value}` : record.value
}

const UBadge = resolveComponent('UBadge')
const CopyText = resolveComponent('CopyText')

const columns: TableColumn<DnsRecord>[] = [
  {
    accessorKey: 'type',
    header: 'Type',
    meta: { class: { th: 'w-24', td: 'w-24 align-top' } },
    cell: ({ row }) =>
      h('div', { class: 'flex flex-col items-start gap-1' }, [
        h(UBadge, { label: row.original.type, variant: 'outline', class: 'font-mono' }),
        h('span', { class: 'text-xs text-muted' }, PURPOSE[row.original.purpose])
      ])
  },
  {
    accessorKey: 'name',
    header: 'Name',
    meta: { class: { th: 'w-[40%]', td: 'w-[40%] align-top' } },
    cell: ({ row }) => h(CopyText, { value: row.original.name, class: 'max-w-full' })
  },
  {
    accessorKey: 'value',
    header: 'Value',
    meta: { class: { td: 'align-top' } },
    cell: ({ row }) =>
      row.original.placeholder
        ? h(
            'span',
            {
              class: 'block truncate font-mono text-xs text-muted',
              title: displayValue(row.original)
            },
            displayValue(row.original)
          )
        : h(CopyText, { value: displayValue(row.original), class: 'max-w-full' })
  }
]
</script>

<template>
  <div class="space-y-2">
    <UTable
      :data="props.records"
      :columns="columns"
      :caption="`DNS records for ${props.domain}`"
      :get-row-id="(record: DnsRecord) => `${record.type}:${record.name}:${record.value}`"
      :ui="{ ...tableUi, base: 'table-fixed w-full min-w-[34rem]' }"
    />
    <p class="text-xs text-muted">
      Some DNS providers add <span class="font-mono">{{ props.domain }}</span> to names
      automatically. If yours does, enter only the part before it.
    </p>
  </div>
</template>
