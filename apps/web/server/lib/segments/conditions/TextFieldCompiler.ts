import type { AnyColumn, SQL } from 'drizzle-orm'
import { contacts } from '../../../db/schema'
import type { SegmentCondition, SegmentField } from '../../../../shared/types/domain'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError, asText } from './ConditionCompiler'
import { TextMatcher } from './TextMatcher'

/** Built-in text columns of a contact. */
const TEXT_COLUMNS: Partial<Record<SegmentField, AnyColumn>> = {
  email: contacts.email,
  first_name: contacts.firstName,
  last_name: contacts.lastName,
  source: contacts.source
}

export class TextFieldCompiler implements ConditionCompiler {
  readonly type = 'text' as const

  compile(condition: SegmentCondition): SQL {
    const column = TEXT_COLUMNS[condition.field]

    if (!column || !TextMatcher.supports(condition.operator))
      throw new UnsupportedConditionError(condition)

    return new TextMatcher(column).match(condition.operator, asText(condition.value))
  }
}
