import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue'

export interface SegmentBuilderOption {
  label: string
  value: string
  description?: string
}

export interface SegmentBuilderOptionSet {
  items: SegmentBuilderOption[]
  loading: boolean
}

export interface SegmentBuilderOptions {
  lists: ComputedRef<SegmentBuilderOptionSet>
  segments: ComputedRef<SegmentBuilderOptionSet>
  topics: ComputedRef<SegmentBuilderOptionSet>
  broadcasts: ComputedRef<SegmentBuilderOptionSet>
  templates: ComputedRef<SegmentBuilderOptionSet>
}

interface NamedRow {
  id: string
  name: string
}

interface BroadcastOptionRow extends NamedRow {
  startedAt: string | null
}

export const SEGMENT_BUILDER_OPTIONS: InjectionKey<SegmentBuilderOptions> =
  Symbol('segment-builder-options')

function isBusy(status: string): boolean {
  return status === 'idle' || status === 'pending'
}

function useOptionRows<T extends NamedRow>(
  url: string,
  key: string,
  query: Record<string, string> = {}
) {
  const { data, status } = useFetch<T[]>(url, {
    key,
    query,
    lazy: true,
    default: () => []
  })

  return { rows: computed(() => data.value ?? []), loading: computed(() => isBusy(status.value)) }
}

function optionSet<T extends NamedRow>(
  source: { rows: ComputedRef<T[]>; loading: ComputedRef<boolean> },
  toOptions: (rows: T[]) => SegmentBuilderOption[] = (rows) =>
    rows.map((row) => ({ label: row.name, value: row.id }))
): ComputedRef<SegmentBuilderOptionSet> {
  return computed(() => ({ items: toOptions(source.rows.value), loading: source.loading.value }))
}

export function optionsWithSelected(
  set: SegmentBuilderOptionSet,
  selected: string | null | undefined,
  missingLabel: string
): SegmentBuilderOption[] {
  if (!selected || set.loading || set.items.some((item) => item.value === selected))
    return set.items

  return [...set.items, { label: missingLabel, value: selected }]
}

export function useSegmentBuilderOptions(
  segmentId?: MaybeRefOrGetter<string | undefined>
): SegmentBuilderOptions {
  const { date } = useFormat()

  return {
    lists: optionSet(useOptionRows<NamedRow>('/api/lists', 'segment-builder-lists')),
    segments: optionSet(
      useOptionRows<NamedRow>('/api/segments', 'segment-builder-segments'),
      (rows) => {
        const current = toValue(segmentId)

        return rows.flatMap((row) =>
          row.id === current ? [] : [{ label: row.name, value: row.id }]
        )
      }
    ),
    topics: optionSet(useOptionRows<NamedRow>('/api/topics', 'segment-builder-topics')),
    broadcasts: optionSet(
      useOptionRows<BroadcastOptionRow>('/api/broadcasts/options', 'segment-builder-broadcasts'),
      (rows) =>
        rows.map((row) => ({
          label: row.name,
          value: row.id,
          description: row.startedAt ? `Sent ${date(row.startedAt)}` : undefined
        }))
    ),
    templates: optionSet(
      useOptionRows<NamedRow>('/api/templates', 'segment-builder-templates', {
        kind: 'transactional'
      })
    )
  }
}

export function injectSegmentBuilderOptions(): SegmentBuilderOptions {
  return inject(SEGMENT_BUILDER_OPTIONS, null) ?? useSegmentBuilderOptions()
}
