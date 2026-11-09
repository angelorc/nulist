# nulist — Design System

The single source of truth for how nulist looks and behaves. Every new screen must follow it.
Direction: **calm, dense, monochrome + one accent**. Structure is felt, not seen.

---

## 1. Principles

1. **Monochrome by default, color carries meaning.** Gray does the layout work. Blue is for focus,
   links, selection, active nav and charts. Green/amber/red appear only for status.
2. **Dense but calm.** 14px base, 32px controls, 40px table rows. No oversized padding.
3. **One primary action per screen.** It lives at the top-right of the navbar and is the only
   solid button visible.
4. **Hairlines, not shadows.** Hierarchy comes from surface steps (`bg`, `bg-elevated`) and 1px
   borders. Shadows only on floating layers (popover, modal, toast, slideover).
5. **Progressive disclosure.** Show the 20% used daily; tuck the rest behind tabs, "Advanced"
   sections, row menus, or the ⌘K palette.
6. **Dark mode is a first-class citizen.** Every screen is checked in both themes.

## 2. Tokens

Implemented in `app/app.config.ts` (Nuxt UI color aliases) and `app/assets/css/main.css`.

### Color

| Role             | Token / Nuxt UI alias                      | Light                                                          | Dark                  |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------- | --------------------- |
| Neutral scale    | `neutral` → Tailwind `neutral` (pure gray) |                                                                |                       |
| Accent           | `primary` → `blue`                         | blue-600                                                       | blue-400              |
| Success          | `success` → `emerald`                      |                                                                |                       |
| Warning          | `warning` → `amber`                        |                                                                |                       |
| Error            | `error` → `red`                            |                                                                |                       |
| Info             | `info` → `sky`                             |                                                                |                       |
| Page background  | `--ui-bg`                                  | white                                                          | neutral-950 `#0a0a0a` |
| Raised surface   | `--ui-bg-elevated`                         | neutral-100                                                    | neutral-900           |
| Sidebar          | `bg-elevated/40`                           |                                                                |                       |
| Border           | `--ui-border`                              | neutral-200                                                    | neutral-800           |
| Text highlighted | `text-highlighted`                         | neutral-900                                                    | white                 |
| Text body        | `text-default`                             | neutral-700                                                    | neutral-200           |
| Text muted       | `text-muted`                               | neutral-500                                                    | neutral-400           |
| Text dimmed      | `text-dimmed`                              | disabled/placeholder only — never meaningful text in dark mode |

Primary CTA buttons use `color="neutral" variant="solid"` (black on light, white on dark).
`color="primary"` is reserved for links, toggles, selection and chart series.

### Status mapping (use `<StatusBadge>` — never hand-pick colors)

| Status                                                                | Color                                             |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| subscribed, confirmed, delivered, sent, completed, active, success    | `success`                                         |
| pending, unconfirmed, scheduled, queued, sending, delayed, processing | `warning` (scheduled/sending/processing → `info`) |
| bounced, complained, failed, rejected, cancelled, error               | `error`                                           |
| unsubscribed, draft, paused, suppressed, disabled                     | `neutral`                                         |

Badges are `variant="subtle"`, size `sm` (12px, app.config), with a leading 6px dot so state never
relies on color alone.

### Typography

- Sans: **Geist** (400/500/600 only). Mono: **Geist Mono** for IDs, keys, emails in logs, JSON,
  endpoints, MJML.
- Every number in a table, KPI or chart uses `tabular-nums`.

| Use                        | Size / line-height | Weight       | Class                                      |
| -------------------------- | ------------------ | ------------ | ------------------------------------------ |
| Metadata, captions, badges | 12/16              | 400–500      | `text-xs`                                  |
| Secondary, cells           | 13/18              | 400–500      | `text-[13px]`                              |
| Body, inputs, buttons      | 14/20              | 400–500      | `text-sm`                                  |
| Section title              | 16/24              | 600          | `text-base font-semibold`                  |
| Page title (navbar)        | 15–16              | 600          | navbar default                             |
| KPI value                  | 28/32              | 600, -0.02em | `text-[28px] font-semibold tracking-tight` |

Negative letter-spacing only at 20px and above.

### Spacing, size, radius

- 4px grid: 4, 8, 12, 16, 20, 24, 32, 48.
- Page gutter 24px (16px mobile). Card/section padding 16px. Gap between sections 24–32px.
- Controls `size="md"` (32px); compact contexts `size="sm"` (28px).
- `--ui-radius: 0.25rem` → controls 6px, cards 8px, overlays 12px. Nothing above 12px except pills.

### Motion

- Hover/press 100–150ms; dropdown/popover 150–200ms; slideover/modal 250ms. Max 300ms.
- Easing `cubic-bezier(0.23, 1, 0.32, 1)`. Enter from `scale(.96)` + opacity, never from 0.
- `prefers-reduced-motion`: opacity fades only.

## 3. App shell

- `UDashboardGroup` + collapsible, resizable `UDashboardSidebar` (icons-only when collapsed).
- Sidebar groups (labels are 12px muted uppercase-free):
  - **Overview** — Dashboard
  - **Audience** — Contacts, Lists, Segments
  - **Messaging** — Broadcasts, Transactional, Templates, Files
  - **Insights** — Logs, Audit log
  - Bottom: Webhooks, Settings, user menu (theme, sign out)
- `⌘K` (`UDashboardSearch`): navigation + actions ("New broadcast", "Import contacts",
  "Add contact") + contact search by email.

## 4. Page anatomy

```
UDashboardPanel
├─ #header
│  ├─ UDashboardNavbar  (title · muted description via #title slot · right: secondary ghost + ONE primary)
│  └─ UDashboardToolbar (optional: search, filter chips, view options, date range)
└─ #body  (gap-6, max readable width for forms: max-w-3xl)
```

- List pages: toolbar + table + footer (count + pagination).
- Detail pages: header with identity + status + actions, `UTabs` for sections, right-hand
  metadata rail (280–320px) on `lg+`.
- Settings: two-column sections (`UPageCard` title/description left, fields right) with a single
  Save button per section, enabled only when dirty.

## 5. Components & patterns

Nuxt UI first: use the primitive, its props, slots and `ui` overrides before writing markup or
classes. App-wide defaults live in `app/app.config.ts` (do not restate them): buttons default
to `color="neutral"`, badges to neutral/subtle/`sm` (12px), alerts to neutral/subtle, modal
and slideover footers to `justify-end gap-2`, UEmpty to `naked`, and UTable carries the table
look below. Semantic colors and tokens only (`text-muted`, `bg-elevated`, `border-default`,
`text-error`…), never palette classes; the only exception is `bg-white` behind rendered email.

### Shared building blocks (`app/components`, `app/composables`, `app/utils`)

| Need                                   | Use                                                                  |
| -------------------------------------- | -------------------------------------------------------------------- |
| Empty / no-results / error / 403 state | `<EmptyState variant icon title description [compact] [appearance]>` |
| Record status                          | `<StatusBadge :status [label]>`                                      |
| KPI tile, period delta                 | `<KpiCard [loading]>`, `<KpiDelta :value :previous>`                 |
| Count + pagination under a list        | `<TableFooter v-model:page :total :page-size [noun]>`                |
| Selected rows actions                  | `<BulkBar :count @clear>`                                            |
| Copy an ID / code / JSON               | `<CopyText>`, `<CopyButton>`, `<CodeBlock>`, `<JsonBlock>`           |
| Relative date with absolute tooltip    | `<TimeAgo :date>`                                                    |
| Role-gated content / primary action    | `<Can :permission>` / `<Can v-slot="{ allowed }" explain>`           |
| Confirm before acting                  | `const confirm = useConfirm()` → `await confirm({ … })`              |
| Mutation with pending + toasts         | `useApiAction(fn, { success, error })`                               |
| Any other toast                        | `useNotify()` (`success`, `info`, `warning`, `error(title, cause)`)  |
| Numbers, dates, percents               | `useFormat()` (never `toFixed` or hand-built strings)                |
| Table columns                          | `tableUi`, `rowActionsColumn()`, `emptyCell()` (`utils/table.ts`)    |

### Page anatomy

```vue
<UDashboardPanel id="contacts">
  <template #header>
    <UDashboardNavbar title="Contacts">
      <template #leading><UDashboardSidebarCollapse /></template> <!-- detail pages: back button -->
      <template #trailing><StatusBadge /> or a count badge</template>
      <template #right>ghost secondary actions · ONE solid neutral primary action</template>
    </UDashboardNavbar>
    <UDashboardToolbar>search · filters · view tabs</UDashboardToolbar>
  </template>
  <template #body>…</template>
</UDashboardPanel>
```

- Detail pages: `#leading` is an icon-only ghost back button (`aria-label="Back to …"`), section
  tabs sit in the `UDashboardToolbar`, never in the body.
- Settings pages are a stack of `<SettingsCard>` (UPageCard: title/description left, fields
  right, one Save per section, enabled only when dirty). No raw UPageCard in settings pages.
- Row and secondary actions that would crowd the navbar go in a trailing `…` UDropdownMenu.

### Toolbars, filters and tabs

- Search: `UInput` with `icon="i-lucide-search"`, an `aria-label`, `class="w-full sm:w-64"`.
  Filters: `USelect` / `USelectMenu` with `aria-label` and `placeholder="All …"`. Filters,
  search and "Clear filters" live in the toolbar, not in the body.
- Status / section tabs in a toolbar: `<UTabs size="sm" :content="false">` (pill, as in the
  Nuxt UI dashboard template). Route sections in a toolbar: `<UNavigationMenu highlight
  class="-mx-1 flex-1">`. Never add `overflow-*` or negative margins to tabs/menus inside
  `UDashboardToolbar`: the toolbar already scrolls horizontally, and the link indicator's 1px
  overflow turns any extra overflow container into a stray vertical scrollbar. Tabs in a card:
  `variant="link" size="sm"` (its border is built in).

### Tables (`UTable`)

- Pass `:data`, typed `TableColumn<T>[]`, `:loading`, and `:ui="tableUi"` (fixed layout).
  Do not add `cursor-pointer`, header or cell classes: app.config styles them. Add `sticky` on
  full-page lists.
- Cells render with `h()` and `resolveComponent` (or `#components` imports): identity first
  (`text-highlighted font-medium`, link to the detail), `<StatusBadge>`, `<TimeAgo>`,
  numbers right-aligned (`text-right tabular-nums` on th and td), `emptyCell()` for no value.
- Row actions: `rowActionsColumn({ items, label })` (ghost `…`, menu aligned end, destructive
  items last in their own group with `color: 'error'`). Clicking the row opens the detail
  (`@select`); UTable already ignores clicks on buttons, links and inputs.
- State chain in the body: error `<EmptyState variant="error">` with Retry → table while
  `loading || rows.length` → `no-results` with "Clear filters" → first-run with the primary
  CTA. Tables inside a card may use the `#empty` slot instead. Then `<TableFooter>`.
- Server-side pagination (`usePaginatedList`) for unbounded collections.

### Empty, loading and error states

- Never a full-page spinner. Loading = UTable `loading`, `USkeleton` shaped like the content
  (`aria-busy="true"` on the container), `KpiCard loading`, or `loading` on the button that
  triggered the work.
- Every fetched view handles its error with `<EmptyState variant="error"
  :description="apiErrorMessage(error)">` + Retry (never `error.statusMessage`).
- `<EmptyState>` inside cards, sections and overlays: `compact`; where a table would stand on
  its own: `appearance="outline"` (no wrapper div with a ring). Actions go in its default slot.

### Forms

- `UForm :schema :state @submit` with a zod schema from `shared/schemas`; every control inside
  a `UFormField label name` (it wires `id`, `aria-invalid`, `aria-describedby` and the error).
  Server or cross-field errors: `UFormField :error`, never a hand-made `<p class="text-error">`.
- Controls `size="md"` (`sm` in toolbars, tables and dense rails), `class="w-full"` inside
  fields. Mono values (`:ui="{ base: 'font-mono' }"`). `required` on the field, `help` below.
- Controls without a visible label (toolbar search, inline editors) carry `aria-label`.
- Submit with a `type="submit"` button (`form="id"` when it lives in a navbar or footer).
  Save is disabled until dirty; Discard (ghost) appears only when dirty. `⌘S` saves editors.

### Overlays

- Open with `useOverlay().create(Component)`; the component wraps `UModal`/`USlideover`, sets
  `title` and `description`, closes with `emit('close', result)` and maps
  `@update:open="(open) => !open && emit('close', …)"`. Inline overlays use `v-model:open`.
- Body in `#body`; actions in `#footer` as direct children (Cancel ghost, then the action);
  no wrapper div. Forms in a modal: `UForm id` in the body, footer submit with `form="id"`.
- `UModal` ≤ 480px (`sm:max-w-xl` at most) for short forms and confirmations; `USlideover`
  (`sm:max-w-xl`, `sm:max-w-2xl`, 720px for email detail) when the list stays in context.
  One overlay deep. Esc closes; focus returns to the trigger.

### Destructive actions

- Trigger: `color="error" variant="soft"` (in rails and danger zones) or a menu item with
  `color: 'error'` in its own last group. Never ghost red in a navbar; the navbar keeps a
  neutral layout and puts Delete in the `…` menu.
- Always `await confirm({ title: 'Delete "Spring sale"?', description: "…can't be undone.",
  confirmLabel: 'Delete broadcast', danger: true })` naming the object and the consequence.

### Permissions

- The screen's primary action stays visible and explains itself when denied:
  `<Can v-slot="{ allowed }" :permission explain><UButton :disabled="!allowed" /></Can>`.
- Secondary actions, row and bulk actions the role cannot perform are hidden (`<Can>`,
  `can()`), not disabled.

### Feedback

- Mutations: `useApiAction` (success toast only when the result is not visible on screen).
  Other toasts: `useNotify()`; never `useToast()` with hand-picked colors and icons.
- Toasts bottom-right, 4s; errors persist until dismissed and carry the server message.
- Inline, persistent conditions: `UAlert` (subtle; `color` = info/warning/error, neutral for
  read-only notices) with an `icon`. Long jobs: `UProgress` + counts, auto-refreshing.

### Keyboard shortcuts (`defineShortcuts`)

- Global: `⌘K` palette, `g` then `d/c/b/t/l` navigation (default layout).
- List pages: `n` → the primary create action, `/` → focus the search input.
- Editors: `meta_s` (with `usingInput: true`) saves. Detail slideovers: `j` / `k` next/previous.
- Advertise every shortcut in the trigger's `UTooltip :kbds`. Never bind a shortcut that the
  member's role cannot use (return `false` from the computed map).

### Code & IDs

- Mono, 12–13px, `bg-elevated` rounded-md, copy on hover/focus, always visible on touch
  (`<CopyText>`, `<CodeBlock>`); JSON with `<JsonBlock>` (pretty-printed, scrolls past
  `max-height`, keyboard-scrollable). Icon-only copy buttons announce "Copied".

### Badges and status

- Status: `<StatusBadge>` only. Other labels (kind, role, method, scope): `UBadge
  variant="outline"` neutral, `size="sm"`; colored only when the label is a warning
  (`warning`/`error` subtle). Pass text with `label`, not as raw children, and never style
  with `capitalize` (sentence case is in the data).

### Accessibility checklist per component

- Icon-only `UButton`: `aria-label`, and a `UTooltip` when the icon is not self-evident.
- `UTooltip` needs a focusable trigger; for hints on static text add `sr-only` text too.
- No click handlers on `div`/`span`/`tr`; use `UButton` (`variant="link"` for inline actions)
  or `ULink`. Collapsibles: `UCollapsible`, not `<details>`.

## 6. Data visualisation

- `UChart` (TanStack Charts). Single hue (primary) per chart; comparison series `neutral`.
  Red only for bounces/complaints.
- Horizontal gridlines only, no axis lines, 3–5 ticks, 12px muted labels, crosshair tooltip.
- Area fill fades from ~15% to 0.
- KPI cards (max 4 per row): 13px muted label → 28px tabular value → delta pill
  (`+12.4%` with arrow) → muted "vs previous period". Delta color follows the metric's good
  direction (bounce rate ↑ = red).
- One global period selector (7d / 30d / 90d) drives the whole dashboard.
- Open rates are labelled as estimates (Apple Mail Privacy Protection); clicks are the trusted
  engagement signal.

## 7. Email-specific patterns

- **Broadcast composer** = single page, not a stepper: left column with inline email-client
  style fields (From, To/audience with live recipient count, Subject, Preview text, Template),
  right 320px **pre-flight checklist** (audience, sender, subject, content, unsubscribe link,
  test sent) — each ✓ / warning / blocker. Send/Schedule live under the checklist and confirm
  in a modal: "Send to 12,480 contacts · Tue 10:00".
- After sending, the same page becomes the report (KPIs, timeline, link clicks, recipients).
- **Segment rule builder**: "Match [all ▾] of the following", rows of property ▾ · operator ▾ ·
  typed value · ×, "+ Condition". Live debounced count "≈ 4,213 contacts" + preview.
- **Email log detail**: vertical event timeline (Queued → Sent → Delivered → Opened → Clicked)
  with timestamps, Preview / HTML / Details tabs, copyable mono IDs.
- **Template editor**: full-screen. Visual (GrapesJS + MJML) or Code (MJML + live preview)
  modes. Variables documented in a side panel (`{{ contact.first_name }}`, `{{ unsubscribe_url }}`).

## 8. Accessibility

- WCAG 2.2 AA: 4.5:1 for text. Muted text is `neutral-500` (light) / `neutral-400` (dark) minimum.
- Visible `:focus-visible` ring (2px primary, 2px offset) on every interactive element.
- Never color alone: dot + label, arrow + sign.
- Hit targets ≥ 24×24. Full keyboard access to row and bulk actions.
- Charts carry an `aria-label` summary.

## 9. Voice

- Sentence case everywhere ("Create broadcast", not "Create Broadcast").
- Short, literal, no exclamation marks, no emoji. Numbers formatted with `Intl.NumberFormat`.
- Errors say what happened and what to do: "SES rejected the request: sender not verified.
  Verify the domain in Settings → Domains."

## 10. Don'ts

- No gradients, glows, glassmorphism, blobs, grid backgrounds.
- No emoji icons — Lucide only (`i-lucide-*`, 16px).
- No colored icon tiles on stat cards, no second accent color.
- No cards inside cards; use sections with dividers.
- No shadows on resting cards. No radius > 12px on controls.
- No colored sidebar. No full-page spinners. No "AI ✨" badges.
