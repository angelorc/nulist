import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { VNode } from 'vue'
import { UButton, UDropdownMenu } from '#components'

/**
 * Fixed table layout for list tables whose columns declare widths (`meta.class.th: 'w-32'`) and
 * truncate long cells. The table look itself (header band, 13px cells, hairline rows, pointer on
 * selectable rows) is the app-wide UTable default in app.config.ts (DESIGN.md §5).
 *
 * `<UTable :ui="tableUi" … />`
 */
export const tableUi = {
  base: 'table-fixed w-full'
} as const

/**
 * Whether a row click started on a control inside the row.
 *
 * @deprecated UTable (4.12) already ignores clicks on `a, button, input, label, select, textarea`
 * before calling `@select`; row handlers no longer need this guard.
 */
export function isInteractiveTarget(event: Event): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest('button, a, input, [role="checkbox"], [role="menuitem"]') !== null
  )
}

/** The muted em dash shown in a cell that has no value. */
export function emptyCell(): VNode {
  return h('span', { class: 'text-dimmed' }, '—')
}

/** Options of {@link rowActionsColumn}. */
export interface RowActionsOptions<T> {
  /** Menu items for a row, grouped; an empty result renders no menu for that row. */
  items: (row: T) => DropdownMenuItem[] | DropdownMenuItem[][]
  /** Accessible name of the row's menu button, e.g. `Actions for ${row.name}`. */
  label: (row: T) => string
}

/** Whether a row produced at least one menu item (flat or grouped). */
function hasItems(items: DropdownMenuItem[] | DropdownMenuItem[][]): boolean {
  return items.some((entry) => !Array.isArray(entry) || entry.length > 0)
}

/**
 * The trailing `…` column with a row's actions (DESIGN.md §5): a ghost icon button opening a
 * UDropdownMenu aligned to the end. Destructive items go in their own last group with
 * `color: 'error'`.
 *
 * ```ts
 * const columns: TableColumn<Broadcast>[] = [
 *   …,
 *   rowActionsColumn({ items: rowActions, label: (row) => `Actions for ${row.name}` })
 * ]
 * ```
 */
export function rowActionsColumn<T>(options: RowActionsOptions<T>): TableColumn<T> {
  return {
    id: 'actions',
    meta: { class: { th: 'w-12', td: 'w-12 text-right' } },
    cell: ({ row }) => {
      const items = options.items(row.original)

      if (!hasItems(items)) return null

      return h(UDropdownMenu, { items, content: { align: 'end' } }, () =>
        h(UButton, {
          icon: 'i-lucide-ellipsis',
          color: 'neutral',
          variant: 'ghost',
          size: 'sm',
          'aria-label': options.label(row.original)
        })
      )
    }
  }
}
