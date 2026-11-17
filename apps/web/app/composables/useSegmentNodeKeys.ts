import type { SegmentNode } from '#shared/types/domain'

export function useSegmentNodeKeys(): (node: SegmentNode) => number {
  const keys = new WeakMap<SegmentNode, number>()
  let seq = 0

  return (node) => {
    const raw = toRaw(node)
    const known = keys.get(raw)

    if (known !== undefined) return known

    seq += 1
    keys.set(raw, seq)

    return seq
  }
}
