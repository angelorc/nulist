/** The toast API this notifier writes to (Nuxt UI's `useToast()`). */
export type ToastApi = Pick<ReturnType<typeof useToast>, 'add' | 'remove'>

/** Extra toast fields a notification may set (actions, id, a custom duration…). */
export type NotifyOptions = Omit<Parameters<ToastApi['add']>[0], 'title' | 'color'>

/**
 * Feedback toasts with the conventions of DESIGN.md §5: bottom-right, colored by outcome, a
 * Lucide icon per outcome; success and info disappear after the app default (4s), errors stay
 * until dismissed and carry the server's client-safe message.
 */
export class Notifier {
  constructor(private readonly toast: ToastApi) {}

  success(title: string, options: NotifyOptions = {}): void {
    this.toast.add({ icon: 'i-lucide-check', ...options, title, color: 'success' })
  }

  info(title: string, options: NotifyOptions = {}): void {
    this.toast.add({ icon: 'i-lucide-info', ...options, title, color: 'neutral' })
  }

  warning(title: string, options: NotifyOptions = {}): void {
    this.toast.add({ icon: 'i-lucide-triangle-alert', ...options, title, color: 'warning' })
  }

  /**
   * A failure. `cause` (a fetch error or Error) becomes the description through
   * {@link apiErrorMessage} unless `options.description` is set.
   */
  error(title: string, cause?: unknown, options: NotifyOptions = {}): void {
    this.toast.add({
      icon: 'i-lucide-circle-alert',
      duration: 0,
      description: cause === undefined ? undefined : apiErrorMessage(cause),
      ...options,
      title,
      color: 'error'
    })
  }

  /** Closes the toast added with this `id`, if it is still shown. */
  dismiss(id: string): void {
    this.toast.remove(id)
  }
}

/**
 * Toasts for user feedback. Prefer it over `useToast()` so every page reports outcomes alike.
 *
 * ```ts
 * const notify = useNotify()
 * notify.success('Endpoint updated')
 * notify.error("Couldn't update topic", error)
 * ```
 */
export function useNotify(): Notifier {
  return new Notifier(useToast())
}
