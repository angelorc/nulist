import { z } from 'zod'
import { LOG_PERIODS } from '#shared/schemas/logs'
import type { FacetBucket } from '#shared/types/logs'
import type { FacetOption } from '~/components/facets/Group.vue'
import type { DateRangeValue } from '~/utils/logLinks'

const dateRangeValueSchema = z.object({
  period: z.enum(LOG_PERIODS).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined)
})

const DATE_RANGE_KEYS = new Set(['period', 'from', 'to'])

export function useLogFacets<S>(
  url: string,
  q: Ref<string>,
  filters: Record<string, string | undefined>
) {
  const { stats: facets, loading: pending, refresh } = useLogStats<S>(url, q, filters, [])
  const mounted = useMounted()
  const loading = computed(() => !mounted.value || pending.value || facets.value === null)

  const range = computed<DateRangeValue>({
    get: () =>
      dateRangeValueSchema.parse({ period: filters.period, from: filters.from, to: filters.to }),
    set: (value) => {
      Object.assign(filters, { period: value.period, from: value.from, to: value.to })
    }
  })

  const facetKeys = () => Object.keys(filters).filter((key) => !DATE_RANGE_KEYS.has(key))

  const active = computed(
    () => (q.value ? 1 : 0) + facetKeys().filter((key) => Boolean(filters[key])).length
  )

  function clear() {
    q.value = ''
    Object.assign(filters, Object.fromEntries(facetKeys().map((key) => [key, undefined])))
  }

  return { facets, loading, refresh, range, active, clear }
}

export function facetOptions(
  buckets: FacetBucket[] | undefined,
  selected: string | undefined,
  describe: (value: string, label: string | null) => Omit<FacetOption, 'value' | 'count'>
): FacetOption[] {
  if (!buckets) {
    return (selected?.split(',').filter(Boolean) ?? []).map((value) =>
      Object.assign({ value, count: null }, describe(value, null))
    )
  }

  return buckets.map((bucket) =>
    Object.assign(
      { value: bucket.value, count: bucket.count },
      describe(bucket.value, bucket.label)
    )
  )
}
