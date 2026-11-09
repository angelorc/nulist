import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts, emailEvents } from '../../../db/schema'
import type {
  EmailEventType,
  SegmentCondition,
  SegmentOperator
} from '../../../../shared/types/domain'
import type { TenantScope } from '../../core/TenantScope'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError, asInteger } from './ConditionCompiler'

const ENGAGEMENT: Partial<Record<SegmentOperator, { event: EmailEventType; negate: boolean }>> = {
  opened_within_days: { event: 'open', negate: false },
  not_opened_within_days: { event: 'open', negate: true },
  clicked_within_days: { event: 'click', negate: false },
  not_clicked_within_days: { event: 'click', negate: true }
}

/** Opened / clicked any email of the organization in the last N days, from the `email_events` stream. */
export class EngagementCompiler implements ConditionCompiler {
  readonly type = 'engagement' as const

  compile(condition: SegmentCondition, scope: TenantScope): SQL {
    const rule = ENGAGEMENT[condition.operator]

    if (!rule) throw new UnsupportedConditionError(condition)
    const happened = sql`exists (select 1 from ${emailEvents} where ${emailEvents.contactId} = ${contacts.id} and ${scope.eq(emailEvents.organizationId)} and ${emailEvents.type} = ${rule.event} and coalesce(${emailEvents.data}->>'isBotEvent', 'false') <> 'true' and ${emailEvents.occurredAt} >= now() - make_interval(days => ${asInteger(condition.value)}))`

    return rule.negate ? sql`not ${happened}` : happened
  }
}
