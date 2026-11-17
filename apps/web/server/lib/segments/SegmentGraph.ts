import type { Database } from '../../db/client'
import { segments } from '../../db/schema'
import {
  segmentReferenceIds,
  segmentReferences,
  segmentRulesSchema
} from '../../../shared/schemas/segments'
import type { SegmentRules } from '../../../shared/types/domain'
import type { TenantScope } from '../core/TenantScope'

export interface SegmentGraphNode {
  id: string
  name: string
  rules: SegmentRules
  references: string[]
}

export class SegmentGraph {
  private constructor(private readonly nodes: ReadonlyMap<string, SegmentGraphNode>) {}

  static async load(db: Database, scope: TenantScope): Promise<SegmentGraph> {
    const rows = await db
      .select({ id: segments.id, name: segments.name, rules: segments.rules })
      .from(segments)
      .where(scope.eq(segments.organizationId))

    return new SegmentGraph(new Map(rows.map((row) => [row.id, SegmentGraph.node(row)])))
  }

  dependents(id: string): SegmentGraphNode[] {
    const closure = this.dependentClosure(id)
    const ordered: SegmentGraphNode[] = []
    const placed = new Set<string>([id])
    let pending = [...closure.values()]

    while (pending.length) {
      const ready = pending.filter((node) =>
        node.references.every((reference) => placed.has(reference) || !closure.has(reference))
      )

      const next = ready.length ? ready : pending

      for (const node of next) {
        ordered.push(node)
        placed.add(node.id)
      }

      pending = pending.filter((node) => !placed.has(node.id))
    }

    return ordered
  }

  reaches(from: string, target: string): boolean {
    const seen = new Set<string>()
    const queue = [from]

    while (queue.length) {
      const current = queue.shift()!

      if (current === target) return true

      if (seen.has(current)) continue

      seen.add(current)
      queue.push(...(this.nodes.get(current)?.references ?? []))
    }

    return false
  }

  private dependentClosure(id: string): Map<string, SegmentGraphNode> {
    const found = new Map<string, SegmentGraphNode>()
    const queue = [id]

    while (queue.length) {
      const current = queue.shift()!

      for (const node of this.nodes.values()) {
        if (node.id === id || found.has(node.id) || !node.references.includes(current)) continue

        found.set(node.id, node)
        queue.push(node.id)
      }
    }

    return found
  }

  private static node(row: Omit<SegmentGraphNode, 'references'>): SegmentGraphNode {
    const parsed = segmentRulesSchema.safeParse(row.rules)

    const references = parsed.success
      ? segmentReferenceIds(segmentReferences(parsed.data).segmentIds)
      : []

    return { ...row, references }
  }
}
