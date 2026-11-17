import { and, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { segments, topics } from '../../db/schema'
import {
  segmentConditionEntries,
  segmentReferenceIds,
  segmentReferences,
  segmentRulesSchema
} from '../../../shared/schemas/segments'
import type { SegmentRules } from '../../../shared/types/domain'
import { ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'

export const MAX_SEGMENT_DEPTH = 5

export const MAX_EXPANDED_SEGMENT_CONDITIONS = 200

const LOOP_MESSAGE = 'Segments cannot include each other in a loop'

const DEPTH_MESSAGE = 'Segments are nested too deeply'

const SIZE_MESSAGE = `Segments can use at most ${MAX_EXPANDED_SEGMENT_CONDITIONS} conditions, counting the conditions of the segments they include`

export interface SegmentTopic {
  id: string
  defaultSubscribed: boolean
}

export interface SegmentRulesCompiler {
  compile(rules: SegmentRules, context: SegmentCompileContext): SQL
}

interface SegmentSize {
  conditions: number
  height: number
}

const NO_SIZE: SegmentSize = { conditions: 0, height: 0 }

function referencedIds(
  ruleSets: readonly SegmentRules[],
  kind: 'segmentIds' | 'topicIds'
): string[] {
  const ids = ruleSets.flatMap((rules) => {
    const parsed = segmentRulesSchema.safeParse(rules)

    return parsed.success ? segmentReferenceIds(segmentReferences(parsed.data)[kind]) : []
  })

  return [...new Set(ids)]
}

export class SegmentCompileContext {
  private readonly stack: string[] = []
  private readonly compiled = new Map<string, SQL>()
  private readonly sizes = new Map<string, SegmentSize>()
  private readonly measuring = new Set<string>()

  private constructor(
    readonly scope: TenantScope,
    private readonly compiler: SegmentRulesCompiler,
    private readonly segmentRules: ReadonlyMap<string, SegmentRules>,
    private readonly topicRows: ReadonlyMap<string, SegmentTopic>
  ) {}

  static async load(
    db: Database,
    scope: TenantScope,
    ruleSets: readonly SegmentRules[],
    compiler: SegmentRulesCompiler,
    overrides: ReadonlyMap<string, SegmentRules> = new Map()
  ): Promise<SegmentCompileContext> {
    const segmentRules = new Map<string, SegmentRules>()
    const queried = new Set<string>()
    let pending = referencedIds(ruleSets, 'segmentIds')

    for (let round = 0; round < MAX_SEGMENT_DEPTH && pending.length; round++) {
      for (const id of pending) queried.add(id)

      const rows = await db
        .select({ id: segments.id, rules: segments.rules })
        .from(segments)
        .where(and(scope.eq(segments.organizationId), inArray(segments.id, pending)))

      for (const row of rows) segmentRules.set(row.id, overrides.get(row.id) ?? row.rules)

      pending = referencedIds(
        rows.map((row) => segmentRules.get(row.id) ?? row.rules),
        'segmentIds'
      ).filter((id) => !queried.has(id))
    }

    const topicIds = referencedIds([...ruleSets, ...segmentRules.values()], 'topicIds')

    const topicRows = topicIds.length
      ? await db
          .select({ id: topics.id, defaultSubscribed: topics.defaultSubscribed })
          .from(topics)
          .where(and(scope.eq(topics.organizationId), inArray(topics.id, topicIds)))
      : []

    return new SegmentCompileContext(
      scope,
      compiler,
      segmentRules,
      new Map(topicRows.map((topic) => [topic.id, topic]))
    )
  }

  assertSize(rules: SegmentRules): void {
    if (this.measureRules(rules).conditions > MAX_EXPANDED_SEGMENT_CONDITIONS)
      throw new ValidationError(SIZE_MESSAGE)
  }

  segment(id: string): SQL | null {
    if (this.stack.includes(id)) throw new ValidationError(LOOP_MESSAGE)

    if (this.stack.length >= MAX_SEGMENT_DEPTH) throw new ValidationError(DEPTH_MESSAGE)

    const rules = this.segmentRules.get(id)

    if (!rules) return null

    if (this.stack.length + this.measure(id).height > MAX_SEGMENT_DEPTH)
      throw new ValidationError(DEPTH_MESSAGE)

    const cached = this.compiled.get(id)

    if (cached) return cached

    this.stack.push(id)

    try {
      const compiled = this.compiler.compile(rules, this)
      this.compiled.set(id, compiled)

      return compiled
    } finally {
      this.stack.pop()
    }
  }

  topic(id: string): SegmentTopic | null {
    return this.topicRows.get(id) ?? null
  }

  private measure(id: string): SegmentSize {
    const known = this.sizes.get(id)

    if (known) return known

    const rules = this.segmentRules.get(id)

    if (!rules) return NO_SIZE

    if (this.measuring.has(id)) throw new ValidationError(LOOP_MESSAGE)

    this.measuring.add(id)

    try {
      const parsed = segmentRulesSchema.safeParse(rules)
      const inner = parsed.success ? this.measureRules(parsed.data) : NO_SIZE
      const size = { conditions: inner.conditions, height: inner.height + 1 }
      this.sizes.set(id, size)

      return size
    } finally {
      this.measuring.delete(id)
    }
  }

  private measureRules(rules: SegmentRules): SegmentSize {
    const nested = segmentReferences(rules).segmentIds.map((reference) =>
      this.measure(reference.id)
    )

    return {
      conditions: nested.reduce(
        (total, size) => total + size.conditions,
        segmentConditionEntries(rules).length
      ),
      height: Math.max(0, ...nested.map((size) => size.height))
    }
  }
}
