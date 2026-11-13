const TOOLBAR = '.tpl-text-toolbar'

const EDITING = '.tpl-text-editor-wrapper'

const FIT_GAP = 8

export class TextToolbarFit {
  private observer: MutationObserver | null = null
  private host: HTMLElement | null = null
  private root: ShadowRoot | null = null
  private toolbar: HTMLElement | null = null
  private canvas: HTMLElement | null = null
  private editing: HTMLElement | null = null
  private shift = { x: 0, y: 0 }
  private frame = 0

  connect(host: HTMLElement): void {
    const root = host.shadowRoot

    if (!root) return

    this.host = host
    this.root = root
    this.observer = new MutationObserver(() => this.update())
    this.observer.observe(root, { childList: true, subtree: true })
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
    this.release()
    this.host = null
    this.root = null
  }

  private update(): void {
    const toolbar = this.root?.querySelector<HTMLElement>(TOOLBAR) ?? null

    if (toolbar === this.toolbar) return

    this.release()

    if (!toolbar) return

    this.toolbar = toolbar
    this.editing = this.root?.querySelector<HTMLElement>(EDITING) ?? null
    this.canvas = TextToolbarFit.scrollParent(this.editing)
    this.fit()
  }

  private release(): void {
    cancelAnimationFrame(this.frame)

    if (this.toolbar) this.toolbar.style.translate = ''

    this.toolbar = null
    this.canvas = null
    this.editing = null
    this.shift = { x: 0, y: 0 }
  }

  private readonly fit = (): void => {
    const toolbar = this.toolbar

    if (!toolbar?.isConnected || !this.host) {
      this.release()

      return
    }

    const rect = toolbar.getBoundingClientRect()
    const host = this.host.getBoundingClientRect()
    const visible = this.canvas?.getBoundingClientRect() ?? host
    const top = rect.top - this.shift.y
    const left = rect.left - this.shift.x
    const y = this.placement(top, rect.height, visible)

    const x = Math.max(
      host.left + FIT_GAP - left,
      Math.min(0, host.right - FIT_GAP - rect.width - left)
    )

    if (x !== this.shift.x || y !== this.shift.y) {
      this.shift = { x, y }
      toolbar.style.translate = x || y ? `${x}px ${y}px` : ''
    }

    this.frame = requestAnimationFrame(this.fit)
  }

  private placement(top: number, height: number, visible: DOMRect): number {
    const ceiling = visible.top + FIT_GAP

    if (top >= ceiling) return 0

    const block = this.editing?.getBoundingClientRect()

    if (block) {
      const below = block.bottom + FIT_GAP

      if (below >= ceiling && below + height <= visible.bottom - FIT_GAP) return below - top
    }

    return Math.max(0, Math.min(ceiling - top, visible.bottom - FIT_GAP - height - top))
  }

  private static scrollParent(element: HTMLElement | null): HTMLElement | null {
    for (let node = element?.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node)

      if (overflowY === 'auto' || overflowY === 'scroll') return node
    }

    return null
  }
}
