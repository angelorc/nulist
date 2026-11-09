import { eq, ne } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts } from '../../../db/schema'
import { contactStatusSchema } from '../../../../shared/schemas/contacts'
import type { SegmentCondition } from '../../../../shared/types/domain'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError } from './ConditionCompiler'

/** `status is / is not <enum value>`. */
export class StatusFieldCompiler implements ConditionCompiler {
  readonly type = 'enum' as const

  compile(condition: SegmentCondition): SQL {
    const status = contactStatusSchema.safeParse(condition.value)

    if (condition.field !== 'status' || !status.success)
      throw new UnsupportedConditionError(condition)

    switch (condition.operator) {
      case 'eq':
        return eq(contacts.status, status.data)
      case 'neq':
        return ne(contacts.status, status.data)
      default:
        throw new UnsupportedConditionError(condition)
    }
  }
}
