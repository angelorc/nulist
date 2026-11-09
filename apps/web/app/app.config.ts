/**
 * Nuxt UI theme: color aliases and the app-wide component defaults of DESIGN.md §2 and §5.
 * Pages should not repeat what is set here (badge sizes, modal footers, the table look…).
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'neutral',
      success: 'emerald',
      warning: 'amber',
      error: 'red',
      info: 'sky'
    },

    // Monochrome by default: the screen's one primary action is `color="neutral"` solid.
    button: {
      defaultVariants: { color: 'neutral', size: 'md' }
    },

    // Badges read at 12px (Nuxt UI's sm is 10px) and are neutral unless they carry a status.
    badge: {
      variants: {
        size: {
          sm: { base: 'text-xs/4 px-1.5 py-0.5 gap-1 rounded-sm' }
        }
      },
      defaultVariants: { color: 'neutral', variant: 'subtle', size: 'sm' }
    },

    alert: {
      defaultVariants: { color: 'neutral', variant: 'subtle' }
    },

    // Overlay actions sit at the end: secondary ghost first, then the action.
    modal: {
      slots: { footer: 'justify-end gap-2' }
    },
    slideover: {
      slots: { footer: 'justify-end gap-2' }
    },

    // Settings sections and page cards use the 14px body size.
    pageCard: {
      slots: { description: 'text-sm' }
    },

    // Help and error text under fields: 13px, close to the control.
    formField: {
      slots: {
        help: 'mt-1.5 text-[13px]',
        error: 'mt-1.5 text-[13px]'
      }
    },

    // Empty states: 20px icon in a 40px raised square, no surface by default.
    empty: {
      slots: { avatar: 'rounded-lg bg-elevated ring ring-default' },
      defaultVariants: { variant: 'naked' }
    },

    // The table look of DESIGN.md §5: header band on bg-elevated/50 with hairline borders,
    // 13px cells, 1px row borders, pointer on rows that open something (`@select`).
    // Fixed layout for width-constrained list tables: `:ui="tableUi"` (app/utils/table.ts).
    table: {
      slots: {
        base: 'border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:data-[selectable=true]:cursor-pointer',
        th: 'py-2 text-[13px] font-medium text-muted first:rounded-l-md last:rounded-r-md border-y border-default first:border-l last:border-r',
        td: 'py-2.5 text-[13px] border-b border-default',
        tr: 'group',
        separator: 'h-0'
      }
    }
  }
})
