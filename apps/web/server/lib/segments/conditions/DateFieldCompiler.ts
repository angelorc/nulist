import { isNotNull, isNull, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { contacts } from '../../../db/schema'
import type { SegmentCondition, SegmentField } from '../../../../shared/types/domain'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError, asInteger, asText } from './ConditionCompiler'

const DATE_COLUMNS: Partial<Record<SegmentField, AnyColumn>> = {
  created_at: contacts.createdAt,
  last_opened_at: contacts.lastOpenedAt,
  last_clicked_at: contacts.lastClickedAt
}

/**
 * Timestamp columns. Relative windows are computed by the database (`now()`);
 * `before`/`after` take an ISO date (YYYY-MM-DD) and compare whole days:
 * before = earlier than that day, after = later than that day.
 * "Not in the last N days" includes contacts where the date is not set.
 */
export class DateFieldCompiler implements ConditionCompiler {
  readonly type = 'date' as const

  compile(condition: SegmentCondition): SQL {
    const column = DATE_COLUMNS[condition.field]

    if (!column) throw new UnsupportedConditionError(condition)

    switch (condition.operator) {
      case 'within_days':
        return sql`${column} >= now() - make_interval(days => ${asInteger(condition.value)})`
      case 'not_within_days':
        return sql`(${column} is null or ${column} < now() - make_interval(days => ${asInteger(condition.value)}))`
      case 'before':
        return sql`${column} < cast(${asText(condition.value)} as date)`
      case 'after':
        return sql`${column} >= cast(${asText(condition.value)} as date) + 1`
      case 'is_set':
        return isNotNull(column)
      case 'is_not_set':
        return isNull(column)
      default:
        throw new UnsupportedConditionError(condition)
    }
  }
}
