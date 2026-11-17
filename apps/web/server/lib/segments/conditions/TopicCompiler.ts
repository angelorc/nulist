import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SegmentFieldCondition } from '../../../../shared/types/domain'
import { TopicService } from '../../lists/TopicService'
import type { SegmentCompileContext } from '../SegmentCompileContext'
import { FieldConditionCompiler, UnsupportedConditionError, asText } from './ConditionCompiler'

export class TopicCompiler extends FieldConditionCompiler {
  readonly type = 'topic' as const

  protected compileField(condition: SegmentFieldCondition, context: SegmentCompileContext): SQL {
    const topicId = asText(condition.value)

    if (!topicId) throw new UnsupportedConditionError(condition)

    const topic = context.topic(topicId)

    switch (condition.operator) {
      case 'subscribed_topic':
        return topic ? TopicService.acceptsTopicCondition(topic) : sql`false`
      case 'unsubscribed_topic':
        return topic ? sql`not ${TopicService.acceptsTopicCondition(topic)}` : sql`true`
      default:
        throw new UnsupportedConditionError(condition)
    }
  }
}
