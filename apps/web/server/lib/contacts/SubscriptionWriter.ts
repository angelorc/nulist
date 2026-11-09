import { sql } from 'drizzle-orm'
import type { Executor } from '../../db/client'
import { contacts, listSubscriptions, lists } from '../../db/schema'
import type { JobLauncher } from '../core/jobs'
import type { TenantScope } from '../core/TenantScope'

export type NewSubscriptionStatus = 'confirmed' | 'unconfirmed'

export interface WrittenSubscription {
  contactId: string
  status: NewSubscriptionStatus
}

const OPT_IN_LAUNCH_CONCURRENCY = 25

/**
 * Set-based list membership writes used by bulk actions and CSV imports.
 * Rules: only `active` contacts are subscribed, existing unsubscribed members
 * are never re-subscribed, and a confirmed write upgrades pending (unconfirmed) members.
 * Contacts and lists of other organizations are never touched, whatever ids are passed.
 */
export class SubscriptionWriter {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Executor
  ) {}

  /** `list_id` restricted to the organization's lists. */
  private get ownedLists() {
    return sql`(select ${lists.id} from ${lists} where ${this.scope.eq(lists.organizationId)})`
  }

  /** Returns the subscriptions that were created or upgraded to confirmed. */
  async addMany(
    contactIds: string[],
    listId: string,
    status: NewSubscriptionStatus
  ): Promise<WrittenSubscription[]> {
    if (!contactIds.length) return []
    const confirmedAt = status === 'confirmed' ? sql`now()` : sql`null`

    const result = await this.db.execute<{ contact_id: string; status: NewSubscriptionStatus }>(sql`
      insert into ${listSubscriptions} (list_id, contact_id, status, confirmed_at)
      select ${listId}::uuid, c.id, ${status}::subscription_status, ${confirmedAt}
      from ${contacts} c
      where c.id = any(${sql.param(contactIds)}::uuid[])
        and ${this.scope.sql('c')}
        and c.status = 'active'
        and ${listId}::uuid in ${this.ownedLists}
      on conflict (list_id, contact_id) do update
        set status = 'confirmed', confirmed_at = now()
        where ${listSubscriptions.status} = 'unconfirmed' and excluded.status = 'confirmed'
      returning contact_id, status
    `)

    return result.rows.map((row) => ({ contactId: row.contact_id, status: row.status }))
  }

  /** Marks memberships as unsubscribed. Returns the contact ids that changed. */
  async removeMany(contactIds: string[], listId: string | null): Promise<string[]> {
    if (!contactIds.length) return []
    const listFilter = listId ? sql`and list_id = ${listId}::uuid` : sql``

    const result = await this.db.execute<{ contact_id: string }>(sql`
      update ${listSubscriptions}
      set status = 'unsubscribed', unsubscribed_at = now()
      where contact_id = any(${sql.param(contactIds)}::uuid[]) ${listFilter}
        and list_id in ${this.ownedLists}
        and status <> 'unsubscribed'
      returning contact_id
    `)

    return [...new Set(result.rows.map((row) => row.contact_id))]
  }

  /** Starts the double opt-in workflow for each pending subscription, a few at a time. */
  static async launchOptIns(
    jobs: JobLauncher,
    organizationId: string,
    contactIds: string[],
    listId: string
  ): Promise<{ failed: string[] }> {
    const failed: string[] = []

    for (let i = 0; i < contactIds.length; i += OPT_IN_LAUNCH_CONCURRENCY) {
      const batch = contactIds.slice(i, i + OPT_IN_LAUNCH_CONCURRENCY)

      const results = await Promise.allSettled(
        batch.map((id) => jobs.doubleOptIn(organizationId, id, listId))
      )

      results.forEach((result, index) => {
        const contactId = batch[index]

        if (result.status === 'rejected' && contactId) failed.push(contactId)
      })
    }

    return { failed }
  }
}
