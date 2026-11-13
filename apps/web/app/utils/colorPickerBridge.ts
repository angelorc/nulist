import { savedColorSchema } from '#shared/schemas/saved-colors'

/** Slot each open colour picker gets; the app's row is assigned to it. */
const SLOT_NAME = 'tpl-saved-colors'

const POPOVER = '.tpl-color-popover'

/** The colour fill of the field whose picker is open (the swatch button's only child). */
const OPEN_SWATCH_FILL = 'button[aria-expanded="true"] > span:only-child'

/** Classes the editor gives that fill while the field is empty or transparent. */
const UNSET_FILLS = ['tpl-color-swatch-empty', 'tpl-color-swatch-transparent']

/** Space kept between an open picker and the edges of the editor, in pixels. */
const FIT_GAP = 8

/** A colour picker element of the visual editor (vanilla-colorful's `<hex-color-picker>`). */
interface HexColorPicker extends HTMLElement {
  color: string
}

/**
 * Brings app content into the visual editor's colour pickers, which open inside
 * the editor's shadow root: the open picker gets a `<slot>`, and {@link target}
 * (rendered by the app, so styled by it) shows there. Follows the open picker's
 * colour and applies a colour the way picking it by hand does. Without the
 * expected markup (another editor version) nothing shows and nothing breaks.
 */
export class ColorPickerBridge {
  /** Element the app renders into; it shows inside whichever picker is open. */
  readonly target = document.createElement('div')

  /** A colour picker is open. */
  readonly open = ref(false)

  /** The open picker's colour (`#rrggbb`); null while its field is empty or transparent. */
  readonly color = ref<string | null>(null)

  private readonly slot = document.createElement('slot')
  private readonly resizes = new ResizeObserver(() => this.fit())
  private observer: MutationObserver | null = null
  private host: HTMLElement | null = null
  private root: ShadowRoot | null = null
  private popover: HTMLElement | null = null
  private picker: HexColorPicker | null = null
  private fill: Element | null = null
  private frame = 0

  constructor() {
    this.slot.name = SLOT_NAME
    this.target.slot = SLOT_NAME
  }

  /** Starts following the pickers of the editor mounted in `host`. */
  connect(host: HTMLElement): void {
    const root = host.shadowRoot

    if (!root) return

    this.host = host
    this.root = root
    host.append(this.target)
    // Popovers open in one layer; the whole shadow root is the fallback.
    const layer = root.querySelector('.tpl-popover-root')

    this.observer = new MutationObserver((records) => this.update(records))
    this.observer.observe(layer ?? root, { childList: true, subtree: !layer })
  }

  /** Applies `color` to the open picker, as dragging its handle would. */
  apply(color: string): void {
    this.picker?.dispatchEvent(new CustomEvent('color-changed', { detail: { value: color } }))
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
    this.resizes.disconnect()
    this.release()
    this.target.remove()
    this.host = null
    this.root = null
  }

  /**
   * The picker added last is the open one: a closing picker stays in the page
   * while it fades out, so it can still be there when the next one opens.
   */
  private update(records: MutationRecord[]): void {
    const opened = records
      .flatMap((record) => [...record.addedNodes])
      .map((node) => ColorPickerBridge.popoverIn(node))
      .findLast((popover) => popover !== null)

    if (opened) this.attach(opened)
    else if (this.popover && !this.popover.isConnected) this.release()
  }

  private attach(popover: HTMLElement): void {
    const picker = popover.querySelector<HexColorPicker>('hex-color-picker')

    this.release()

    if (!picker) return

    this.popover = popover
    this.picker = picker
    popover.append(this.slot)
    this.resizes.observe(popover)
    this.open.value = true
    this.follow()
  }

  private release(): void {
    if (this.popover) this.resizes.unobserve(this.popover)
    cancelAnimationFrame(this.frame)
    this.slot.remove()
    this.popover = null
    this.picker = null
    this.fill = null
    this.open.value = false
    this.color.value = null
  }

  /**
   * Moves the open picker up when it runs past the bottom of the editor: the
   * editor places it below its swatch expecting a shorter picker. Measured
   * without transforms, so its opening animation does not skew the result.
   */
  private fit(): void {
    const popover = this.popover

    if (!popover || !this.host) return

    popover.style.marginTop = ''

    const bounds = this.host.getBoundingClientRect()
    const top = (popover.offsetParent?.getBoundingClientRect().top ?? 0) + popover.offsetTop
    const overflow = top + popover.offsetHeight - (bounds.bottom - FIT_GAP)
    const shift = Math.max(0, Math.min(overflow, top - (bounds.top + FIT_GAP)))

    if (shift > 0) popover.style.marginTop = `-${shift}px`
  }

  /**
   * Reads the colour on every frame while the picker is open: the editor shows
   * a change in its own time (the text toolbar two frames later), from clicks,
   * drags, keys and undo alike.
   */
  private readonly follow = (): void => {
    // Found again when the editor re-renders the field and replaces its swatch.
    if (!this.fill?.isConnected) this.fill = this.root?.querySelector(OPEN_SWATCH_FILL) ?? null

    const unset = UNSET_FILLS.some((name) => this.fill?.classList.contains(name))
    const parsed = savedColorSchema.safeParse(this.picker?.color ?? '')

    this.color.value = !unset && parsed.success ? parsed.data : null
    this.frame = requestAnimationFrame(this.follow)
  }

  private static popoverIn(node: Node): HTMLElement | null {
    if (!(node instanceof HTMLElement)) return null

    return node.matches(POPOVER) ? node : node.querySelector<HTMLElement>(POPOVER)
  }
}
