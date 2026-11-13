import { SAVED_COLOR_LIMIT } from '#shared/schemas/saved-colors'
import type { Notifier } from './useNotify'

const ENDPOINT = '/api/templates/saved-colors'

/**
 * The organization's saved colours, shown in every colour picker of the visual
 * editor. Changes show at once and are undone if the server refuses them.
 */
export class SavedColors {
  /** Saved colours (`#rrggbb`), oldest first. */
  readonly colors = ref<string[]>([])

  /** A change is on its way to the server. */
  readonly busy = ref(false)

  readonly limit = SAVED_COLOR_LIMIT

  constructor(private readonly notify: Notifier) {}

  /** Loads the colours; without them the pickers simply show none. */
  async load(): Promise<void> {
    try {
      this.colors.value = await $fetch<string[]>(ENDPOINT)
    } catch {
      this.colors.value = []
    }
  }

  has(color: string): boolean {
    return this.colors.value.includes(color)
  }

  /** Saves `color`, or removes it when it is already saved; one change at a time. */
  async toggle(color: string): Promise<void> {
    if (this.busy.value) return

    const before = this.colors.value
    const saved = this.has(color)

    this.busy.value = true
    this.colors.value = saved ? before.filter((item) => item !== color) : [...before, color]

    try {
      this.colors.value = saved
        ? await $fetch<string[]>(`${ENDPOINT}/${color.slice(1)}`, { method: 'DELETE' })
        : await $fetch<string[]>(ENDPOINT, { method: 'POST', body: { color } })
    } catch (error) {
      this.colors.value = before
      this.notify.error(saved ? "Couldn't remove the color" : "Couldn't save the color", error)
    } finally {
      this.busy.value = false
    }
  }
}

export function useSavedColors(): SavedColors {
  return new SavedColors(useNotify())
}
