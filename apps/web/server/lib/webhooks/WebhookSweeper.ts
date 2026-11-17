import { and, eq, exists, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { webhookDeliveries, webhookEndpoints } from '../../db/schema'
import type { WebhookDispatcher } from './WebhookDispatcher'

export interface WebhookSweepRun {
  skipped: boolean
  organizations: number
}

export interface WebhookTenantResolver {
  forOrganization(organizationId: string): { readonly webhooks: WebhookDispatcher }
}

type LockRow = {
  locked: boolean
}

const LOCK_KEY = 'webhook-delivery-sweeper'

export class WebhookSweeper {
  constructor(
    private readonly db: Database,
    private readonly tenants: WebhookTenantResolver
  ) {}

  async run(): Promise<WebhookSweepRun> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<LockRow>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) as locked`
      )

      if (!lock.rows[0]?.locked) return { skipped: true, organizations: 0 }

      const due = tx
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.endpointId, webhookEndpoints.id),
            eq(webhookDeliveries.status, 'pending'),
            lte(webhookDeliveries.nextAttemptAt, sql`now()`)
          )
        )

      const rows = await tx
        .selectDistinct({ organizationId: webhookEndpoints.organizationId })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.enabled, true),
            or(
              isNull(webhookEndpoints.drainLeaseUntil),
              lt(webhookEndpoints.drainLeaseUntil, sql`now()`)
            ),
            exists(due)
          )
        )

      await Promise.all(
        rows.map((row) => this.tenants.forOrganization(row.organizationId).webhooks.wake())
      )

      return { skipped: false, organizations: rows.length }
    })
  }
}
