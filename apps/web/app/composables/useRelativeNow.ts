import { createSharedComposable, useMounted, useNow } from '@vueuse/core'

/** One 30s clock shared by every relative timestamp on the page. */
const useTicker = createSharedComposable(() => useNow({ interval: 30_000 }))

/**
 * "Now" for relative timestamps that hydrates without text mismatches: while
 * the page hydrates, the server's clock (sent in the payload) is used; once
 * mounted, a shared ticker keeps "5 minutes ago" up to date.
 */
export function useRelativeNow() {
  const serverNow = useState<number>('relative-now', () => Date.now())

  if (import.meta.server) return computed(() => serverNow.value)

  const ticker = useTicker()
  const hydrating = useNuxtApp().isHydrating
  const mounted = useMounted()

  return computed(() => (hydrating && !mounted.value ? serverNow.value : ticker.value.getTime()))
}
