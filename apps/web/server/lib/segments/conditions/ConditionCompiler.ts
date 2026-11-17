import type { SQL } from 'drizzle-orm'
import type {
  SegmentCondition,
  SegmentFieldCondition,
  SegmentFieldType
} from '../../../../shared/types/domain'
import type { SegmentCompileContext } from '../SegmentCompileContext'

/**
 * Strategy that compiles one (already validated) segment condition into a
 * parameterized SQL predicate over the `contacts` table. Values are always
 * bound as parameters; identifiers come from fixed whitelists only.
 * Sub-selects over other tenant tables (lists, email events) are restricted to `context.scope`.
 */
export interface ConditionCompiler {
  readonly type: SegmentFieldType
  compile(condition: SegmentCondition, context: SegmentCompileContext): SQL
}

export abstract class FieldConditionCompiler implements ConditionCompiler {
  abstract readonly type: SegmentFieldType

  compile(condition: SegmentCondition, context: SegmentCompileContext): SQL {
    if (condition.field === 'activity') throw new UnsupportedConditionError(condition)

    return this.compileField(condition, context)
  }

  protected abstract compileField(
    condition: SegmentFieldCondition,
    context: SegmentCompileContext
  ): SQL
}

/** Thrown when a condition reaches a compiler it cannot handle (programming error, not user input). */
export class UnsupportedConditionError extends Error {
  constructor(condition: Pick<SegmentCondition, 'field' | 'operator'>) {
    super(`Unsupported segment condition: ${condition.field} ${condition.operator}`)
    this.name = 'UnsupportedConditionError'
  }
}

export function asText(value: SegmentFieldCondition['value']): string {
  return value === null || value === undefined ? '' : String(value)
}

export function asInteger(value: SegmentFieldCondition['value']): number {
  const number = Number(value)

  if (!Number.isInteger(number)) throw new TypeError('Expected an integer condition value')

  return number
}

export function asNumber(value: SegmentFieldCondition['value']): number {
  const number = Number(value)

  if (!Number.isFinite(number)) throw new TypeError('Expected a numeric condition value')

  return number
}
