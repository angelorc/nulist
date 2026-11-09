import type { SQL } from 'drizzle-orm'
import type { SegmentCondition, SegmentFieldType } from '../../../../shared/types/domain'
import type { TenantScope } from '../../core/TenantScope'

/**
 * Strategy that compiles one (already validated) segment condition into a
 * parameterized SQL predicate over the `contacts` table. Values are always
 * bound as parameters; identifiers come from fixed whitelists only.
 * Sub-selects over other tenant tables (lists, email events) are restricted to `scope`.
 */
export interface ConditionCompiler {
  readonly type: SegmentFieldType
  compile(condition: SegmentCondition, scope: TenantScope): SQL
}

/** Thrown when a condition reaches a compiler it cannot handle (programming error, not user input). */
export class UnsupportedConditionError extends Error {
  constructor(condition: Pick<SegmentCondition, 'field' | 'operator'>) {
    super(`Unsupported segment condition: ${condition.field} ${condition.operator}`)
    this.name = 'UnsupportedConditionError'
  }
}

export function asText(value: SegmentCondition['value']): string {
  return value === null || value === undefined ? '' : String(value)
}

export function asInteger(value: SegmentCondition['value']): number {
  const number = Number(value)

  if (!Number.isInteger(number)) throw new TypeError('Expected an integer condition value')

  return number
}

export function asNumber(value: SegmentCondition['value']): number {
  const number = Number(value)

  if (!Number.isFinite(number)) throw new TypeError('Expected a numeric condition value')

  return number
}
