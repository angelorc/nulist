export function useLogStats<S>(
  url: string,
  q: Ref<string>,
  filters: Record<string, string | undefined>,
  facetKeys: readonly string[]
) {
  const search = refDebounced(q, 300)

  const query = computed(() => ({
    q: search.value || undefined,
    ...Object.fromEntries(
      Object.entries(filters).filter(
        ([key, value]) => !facetKeys.includes(key) && value !== undefined && value !== 'all'
      )
    )
  }))

  const { data, status, refresh } = useAsyncData(
    () => `log-stats:${url}:${JSON.stringify(query.value)}`,
    () => $fetch<S>(url, { query: query.value }),
    { lazy: true, server: false, default: () => null }
  )

  return { stats: data, loading: computed(() => status.value === 'pending'), refresh }
}
