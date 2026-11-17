import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SegmentFieldCondition } from '../../../../shared/types/domain'
import type { SegmentCompileContext } from '../SegmentCompileContext'
import { FieldConditionCompiler, UnsupportedConditionError, asText } from './ConditionCompiler'

export class SegmentMembershipCompiler extends FieldConditionCompiler {
  readonly type = 'segment' as const

  protected compileField(condition: SegmentFieldCondition, context: SegmentCompileContext): SQL {
    const segmentId = asText(condition.value)

    if (!segmentId) throw new UnsupportedConditionError(condition)

    const membership = context.segment(segmentId)

    switch (condition.operator) {
      case 'in_segment':
        return membership ? sql`(${membership})` : sql`false`
      case 'not_in_segment':
        return membership ? sql`not coalesce(${membership}, false)` : sql`true`
      default:
        throw new UnsupportedConditionError(condition)
    }
  }
}
