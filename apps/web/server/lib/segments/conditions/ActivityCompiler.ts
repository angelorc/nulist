import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts, emailEvents, messages } from '../../../db/schema'
import type {
  EmailEventType,
  SegmentActivityCondition,
  SegmentActivityEvent,
  SegmentCondition
} from '../../../../shared/types/domain'
import { containsPattern } from '../../core/sql'
import type { SegmentCompileContext } from '../SegmentCompileContext'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError } from './ConditionCompiler'

const EVENT_TYPES: Record<SegmentActivityEvent, EmailEventType> = {
  sent: 'send',
  delivered: 'delivery',
  opened: 'open',
  clicked: 'click',
  bounced: 'bounce',
  complained: 'complaint',
  unsubscribed: 'unsubscribe'
}

const HUMAN_EVENTS: ReadonlySet<EmailEventType> = new Set(['open', 'click'])

export class ActivityCompiler implements ConditionCompiler {
  readonly type = 'activity' as const

  compile(condition: SegmentCondition, context: SegmentCompileContext): SQL {
    if (condition.field !== 'activity') throw new UnsupportedConditionError(condition)

    const where = sql.join(this.filters(condition, context), sql` and `)

    if (condition.operator === 'has_not')
      return sql`not exists (select 1 from ${emailEvents} where ${where})`

    const times = condition.times ?? 1

    if (times <= 1) return sql`exists (select 1 from ${emailEvents} where ${where})`

    return sql`(select count(*) from ${emailEvents} where ${where}) >= ${times}`
  }

  private filters(condition: SegmentActivityCondition, context: SegmentCompileContext): SQL[] {
    const type = EVENT_TYPES[condition.event]

    const filters = [
      sql`${emailEvents.contactId} = ${contacts.id}`,
      context.scope.eq(emailEvents.organizationId),
      sql`${emailEvents.type} = ${type}`
    ]

    if (condition.days)
      filters.push(
        sql`${emailEvents.occurredAt} >= now() - make_interval(days => ${condition.days})`
      )

    if (HUMAN_EVENTS.has(type))
      filters.push(sql`coalesce(${emailEvents.data}->>'isBotEvent', 'false') <> 'true'`)

    if (condition.event === 'clicked' && condition.link)
      filters.push(
        sql`coalesce(${emailEvents.data}->>'link', ${emailEvents.data}#>>'{click,link}') ilike ${containsPattern(condition.link)}`
      )

    filters.push(this.messageFilter(condition))

    return filters
  }

  private messageFilter(condition: SegmentActivityCondition): SQL {
    const message = sql`${messages.id} = ${emailEvents.messageId}`

    switch (condition.scope) {
      case 'broadcast': {
        const broadcast = condition.broadcastId
          ? sql` and ${messages.broadcastId} = ${condition.broadcastId}::uuid`
          : sql``

        return sql`exists (select 1 from ${messages} where ${message} and ${messages.kind} = 'broadcast'${broadcast})`
      }

      case 'transactional': {
        const template = condition.templateId
          ? sql` and ${messages.templateId} = ${condition.templateId}::uuid`
          : sql``

        const tag = condition.tag
          ? sql` and ${messages.tags} ->> ${condition.tag.key}::text = ${condition.tag.value}::text`
          : sql``

        return sql`exists (select 1 from ${messages} where ${message} and ${messages.kind} = 'transactional'${template}${tag})`
      }

      default:
        return sql`not exists (select 1 from ${messages} where ${message} and ${messages.kind} = 'system')`
    }
  }
}
