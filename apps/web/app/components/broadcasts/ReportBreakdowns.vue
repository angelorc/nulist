<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BroadcastReport, LinkClickStat } from '#shared/types/analytics'

type DomainStat = BroadcastReport['domains'][number]

/** Top clicked links and the recipient domain breakdown, side by side. */
const props = defineProps<{ report: BroadcastReport | null; loading?: boolean }>()

const { number, percent } = useFormat()

const links = computed(() => props.report?.links ?? [])
const domains = computed(() => props.report?.domains ?? [])

/** Skeletons only for the first load; refreshes keep the rows on screen. */
const firstLoad = computed(() => props.loading && !props.report)

const maxClicks = computed(() => Math.max(1, ...links.value.map((l) => l.uniqueClicks)))

const totalRecipients = computed(() => Math.max(1, props.report?.totals.recipients ?? 0))

/** The link without its UTM parameters, as people read it. */
function displayUrl(url: string) {
  try {
    const parsed = new URL(url)

    const tracking = Array.from(parsed.searchParams.keys()).filter((key) => key.startsWith('utm_'))

    for (const key of tracking) parsed.searchParams.delete(key)

    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

const ULink = resolveComponent('ULink')

const numeric = (width: string, visibility = '') => ({
  class: {
    th: `${width} ${visibility} text-right`,
    td: `${width} ${visibility} text-right tabular-nums`
  }
})

const linkColumns: TableColumn<LinkClickStat>[] = [
  {
    accessorKey: 'url',
    header: 'Link',
    cell: ({ row }) =>
      h('div', { class: 'relative min-w-0' }, [
        h('span', {
          class: 'absolute -inset-y-1 -start-1 rounded-sm bg-primary/8',
          style: { width: `${(row.original.uniqueClicks / maxClicks.value) * 100}%` },
          'aria-hidden': 'true'
        }),
        h(
          ULink,
          {
            to: row.original.url,
            target: '_blank',
            title: row.original.url,
            class:
              'relative block truncate text-highlighted hover:text-highlighted hover:underline underline-offset-2'
          },
          () => displayUrl(row.original.url)
        )
      ])
  },
  {
    accessorKey: 'uniqueClicks',
    header: 'Unique',
    meta: numeric('w-20'),
    cell: ({ row }) => h('span', { class: 'text-highlighted' }, number(row.original.uniqueClicks))
  },
  {
    accessorKey: 'clicks',
    header: 'Total',
    meta: numeric('w-20', 'hidden sm:table-cell'),
    cell: ({ row }) => h('span', { class: 'text-muted' }, number(row.original.clicks))
  }
]

const domainColumns: TableColumn<DomainStat>[] = [
  {
    accessorKey: 'domain',
    header: 'Domain',
    cell: ({ row }) =>
      h('span', { class: 'block truncate font-mono text-xs text-highlighted' }, row.original.domain)
  },
  {
    accessorKey: 'recipients',
    header: 'Recipients',
    meta: numeric('w-32'),
    cell: ({ row }) =>
      h('span', { class: 'text-highlighted' }, [
        number(row.original.recipients),
        h(
          'span',
          { class: 'ms-1.5 text-muted' },
          percent(row.original.recipients / totalRecipients.value)
        )
      ])
  },
  {
    accessorKey: 'delivered',
    header: 'Delivered',
    meta: numeric('w-24', 'hidden sm:table-cell'),
    cell: ({ row }) =>
      h(
        'span',
        { class: 'text-muted' },
        percent(row.original.recipients ? row.original.delivered / row.original.recipients : 0)
      )
  },
  {
    accessorKey: 'opens',
    header: 'Opens',
    meta: numeric('w-20'),
    cell: ({ row }) =>
      h(
        'span',
        { class: 'text-muted' },
        percent(row.original.delivered ? row.original.opens / row.original.delivered : 0)
      )
  }
]
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <DashboardSection title="Top links" description="Unique clicks per link" flush>
      <div class="px-4 pb-4">
        <UTable :data="links" :columns="linkColumns" :loading="firstLoad" :ui="tableUi">
          <template #loading>
            <div class="space-y-3 py-1" aria-busy="true">
              <USkeleton v-for="i in 4" :key="i" class="h-4 w-full" />
            </div>
          </template>
          <template #empty>
            <EmptyState
              compact
              icon="i-lucide-mouse-pointer-click"
              title="No clicks yet"
              description="Clicked links show up here as provider events arrive."
            />
          </template>
        </UTable>
      </div>
    </DashboardSection>

    <DashboardSection title="Domains" description="Where your recipients receive email" flush>
      <div class="px-4 pb-4">
        <UTable :data="domains" :columns="domainColumns" :loading="firstLoad" :ui="tableUi">
          <template #loading>
            <div class="space-y-3 py-1" aria-busy="true">
              <USkeleton v-for="i in 4" :key="i" class="h-4 w-full" />
            </div>
          </template>
          <template #empty>
            <EmptyState
              compact
              icon="i-lucide-globe"
              title="No recipients yet"
              description="Domains appear once emails are handed to the provider."
            />
          </template>
        </UTable>
      </div>
    </DashboardSection>
  </div>
</template>
