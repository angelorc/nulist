import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts } from '../../../db/schema'
import { ATTRIBUTE_KEY_PATTERN } from '../../../../shared/schemas/segments'
import type { SegmentCondition } from '../../../../shared/types/domain'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError, asNumber, asText } from './ConditionCompiler'
import { TextMatcher } from './TextMatcher'

/** Strict decimal literal; checked before casting so non-numeric values never raise. Bound as a parameter. */
const NUMERIC_PATTERN = '^[-+]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'

/**
 * Custom attributes stored in `contacts.attributes` (jsonb). The key is always
 * a bound parameter (`attributes ->> $1`), never part of the SQL text.
 */
export class AttributeCompiler implements ConditionCompiler {
  readonly type = 'attribute' as const

  compile(condition: SegmentCondition): SQL {
    const key = condition.key ?? ''

    if (!ATTRIBUTE_KEY_PATTERN.test(key)) throw new UnsupportedConditionError(condition)

    const value = sql`(${contacts.attributes} ->> ${key}::text)`

    switch (condition.operator) {
      case 'is_set':
        return sql`(${contacts.attributes} ? ${key}::text and coalesce(${value}, '') <> '')`
      case 'is_not_set':
        return sql`(not (${contacts.attributes} ? ${key}::text) or coalesce(${value}, '') = '')`
      case 'gt':
      case 'lt': {
        // CASE guarantees the cast only runs on values that passed the numeric check.
        const numeric = sql`(case when btrim(${value}) ~ ${NUMERIC_PATTERN}::text then btrim(${value})::numeric end)`

        return condition.operator === 'gt'
          ? sql`${numeric} > ${asNumber(condition.value)}::numeric`
          : sql`${numeric} < ${asNumber(condition.value)}::numeric`
      }

      default:
        if (!TextMatcher.supports(condition.operator))
          throw new UnsupportedConditionError(condition)

        return new TextMatcher(value).match(condition.operator, asText(condition.value))
    }
  }
}
