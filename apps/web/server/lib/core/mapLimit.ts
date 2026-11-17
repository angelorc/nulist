/** Runs `fn` over `items` with at most `limit` calls in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  const queue = items.entries()

  // Workers share one iterator, so each item is taken exactly once.
  const worker = async (): Promise<void> => {
    const next = queue.next()

    if (next.done) return
    const [index, item] = next.value
    results[index] = await fn(item)

    return worker()
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}
