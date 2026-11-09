import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts, listSubscriptions, lists } from '../../../db/schema'
import type { SegmentCondition } from '../../../../shared/types/domain'
import type { TenantScope } from '../../core/TenantScope'
import type { ConditionCompiler } from './ConditionCompiler'
import { UnsupportedConditionError, asText } from './ConditionCompiler'

/** Builds `($1, $2, …)` from uuid strings, each bound as a parameter. */
export function uuidList(ids: readonly string[]): SQL {
  return sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )})`
}

/**
 * Confirmed membership of the contact in one or more lists of the organization
 * (correlated EXISTS). List ids of another organization match nothing.
 */
export function confirmedMembership(scope: TenantScope, listIds: readonly string[]): SQL {
  const ownLists = sql`select ${lists.id} from ${lists} where ${scope.eq(lists.organizationId)} and ${lists.id} in ${uuidList(listIds)}`

  return sql`exists (select 1 from ${listSubscriptions} where ${listSubscriptions.contactId} = ${contacts.id} and ${listSubscriptions.status} = 'confirmed' and ${listSubscriptions.listId} in (${ownLists}))`
}

/** `is in list` / `is not in list`: confirmed subscriptions only. */
export class ListMembershipCompiler implements ConditionCompiler {
  readonly type = 'list' as const

  compile(condition: SegmentCondition, scope: TenantScope): SQL {
    const listId = asText(condition.value)

    if (!listId) throw new UnsupportedConditionError(condition)
    const membership = confirmedMembership(scope, [listId])

    switch (condition.operator) {
      case 'in_list':
        return membership
      case 'not_in_list':
        return sql`not ${membership}`
      default:
        throw new UnsupportedConditionError(condition)
    }
  }
}
