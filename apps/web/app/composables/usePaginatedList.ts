import { z } from 'zod'
import type { Paginated } from '#shared/types/domain'

const queryValueSchema = z.string()

/**
 * Server-side paginated list with debounced search and extra filters, kept in the URL query.
 * `useFetch` re-runs whenever page / search / filters change.
 */
export function usePaginatedList<
  T,
  F extends Record<string, string | undefined> = Record<string, string | undefined>
>(url: string | (() => string), options: { pageSize?: number; filters?: F; key?: string } = {}) {
  const route = useRoute()
  const router = useRouter()

  const page = ref(Number(route.query.page) || 1)
  const q = ref(String(route.query.q ?? ''))
  const filters = reactive(Object.assign({}, options.filters))

  /** Filter values present in the URL query (only for the filters this list declares). */
  const fromQuery = Object.fromEntries(
    Object.keys(filters).flatMap((key) => {
      const parsed = queryValueSchema.safeParse(route.query[key])

      return parsed.success ? [[key, parsed.data]] : []
    })
  )

  Object.assign(filters, fromQuery)

  const debouncedQ = refDebounced(q, 300)
  const pageSize = options.pageSize ?? 25

  watch([debouncedQ, () => ({ ...filters })], () => {
    page.value = 1
  })

  const query = computed(() => {
    const active = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== 'all')
    )

    return { page: page.value, pageSize, q: debouncedQ.value || undefined, ...active }
  })

  watch(query, (value) => {
    void router.replace({
      query: {
        ...route.query,
        ...value,
        pageSize: undefined,
        page: value.page > 1 ? value.page : undefined
      }
    })
  })

  const { data, status, refresh, error } = useFetch<Paginated<T>>(url, {
    query,
    key: options.key,
    default: () => ({ items: [], total: 0, page: 1, pageSize })
  })

  const items = computed(() => data.value?.items ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const loading = computed(() => status.value === 'pending')

  const isFiltered = computed(
    () => !!debouncedQ.value || Object.values(filters).some((v) => v && v !== 'all')
  )

  function clearFilters() {
    q.value = ''
    Object.assign(filters, Object.fromEntries(Object.keys(filters).map((key) => [key, undefined])))
  }

  return {
    page,
    pageSize,
    q,
    filters,
    items,
    total,
    loading,
    status,
    error,
    refresh,
    isFiltered,
    clearFilters
  }
}
