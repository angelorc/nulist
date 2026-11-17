import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts, emailEvents } from '../../../db/schema'
import type {
  EmailEventType,
  SegmentFieldCondition,
  SegmentOperator
} from '../../../../shared/types/domain'
import type { SegmentCompileContext } from '../SegmentCompileContext'
import { FieldConditionCompiler, UnsupportedConditionError, asInteger } from './ConditionCompiler'

const ENGAGEMENT: Partial<Record<SegmentOperator, { event: EmailEventType; negate: boolean }>> = {
  opened_within_days: { event: 'open', negate: false },
  not_opened_within_days: { event: 'open', negate: true },
  clicked_within_days: { event: 'click', negate: false },
  not_clicked_within_days: { event: 'click', negate: true }
}

/** Opened / clicked any email of the organization in the last N days, from the `email_events` stream. */
export class EngagementCompiler extends FieldConditionCompiler {
  readonly type = 'engagement' as const

  protected compileField(condition: SegmentFieldCondition, context: SegmentCompileContext): SQL {
    const rule = ENGAGEMENT[condition.operator]

    if (!rule) throw new UnsupportedConditionError(condition)
    const happened = sql`exists (select 1 from ${emailEvents} where ${emailEvents.contactId} = ${contacts.id} and ${context.scope.eq(emailEvents.organizationId)} and ${emailEvents.type} = ${rule.event} and coalesce(${emailEvents.data}->>'isBotEvent', 'false') <> 'true' and ${emailEvents.occurredAt} >= now() - make_interval(days => ${asInteger(condition.value)}))`

    return rule.negate ? sql`not ${happened}` : happened
  }
}
