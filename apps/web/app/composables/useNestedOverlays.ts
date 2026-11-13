import type { InjectionKey, Ref } from 'vue'

const NESTED_OVERLAYS: InjectionKey<Ref<number>> = Symbol('nested-overlays')

export function provideNestedOverlays(): Readonly<Ref<number>> {
  const count = ref(0)

  provide(NESTED_OVERLAYS, count)

  return count
}

export function trackNestedOverlay(open: Ref<boolean>): void {
  const count = inject(NESTED_OVERLAYS, null)

  if (!count) return

  watch(open, (value) => {
    count.value += value ? 1 : -1
  })

  onBeforeUnmount(() => {
    if (open.value) count.value -= 1
  })
}
