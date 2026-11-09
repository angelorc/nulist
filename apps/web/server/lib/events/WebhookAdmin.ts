import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { webhookDeliveries, webhookEndpoints } from '../../db/schema'
import type { WebhookEndpointInput, WebhookEndpointUpdate } from '../../../shared/schemas/webhooks'
import { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { NotFoundError } from '../core/errors'
import type { WebhookService } from '../webhooks/WebhookService'
import type { TenantScope } from '../core/TenantScope'

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect

/** Health over the most recent deliveries of one endpoint. */
export interface EndpointStats {
  /** Deliveries considered (most recent first, capped at STATS_WINDOW). */
  total: number
  success: number
  failed: number
  pending: number
  /** success / (success + failed), null before the first settled delivery. */
  successRate: number | null
  lastDeliveryAt: Date | null
}

export type WebhookEndpointSummary = Omit<WebhookEndpointRow, 'secret'> & { stats: EndpointStats }

export type WebhookEndpointDetail = WebhookEndpointRow & { stats: EndpointStats }

const STATS_WINDOW = 50

interface StatsRow extends Record<string, unknown> {
  endpoint_id: string
  total: number
  success: number
  failed: number
  pending: number
  last_delivery_at: Date | string | null
}

/**
 * Dashboard operations on the organization's outbound webhooks: endpoint CRUD
 * with audit entries and delivery health. Delivery itself stays in the
 * organization's WebhookService, so ids of other organizations are not found.
 */
export class WebhookAdmin {
  static readonly STATS_WINDOW = STATS_WINDOW

  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly webhooks: WebhookService,
    private readonly audit: AuditLogger
  ) {}

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------
  async listEndpoints(): Promise<WebhookEndpointSummary[]> {
    const [endpoints, stats] = await Promise.all([this.webhooks.listEndpoints(), this.stats()])

    return endpoints.map(({ secret: _secret, ...endpoint }) => ({
      ...endpoint,
      stats: stats.get(endpoint.id) ?? WebhookAdmin.emptyStats()
    }))
  }

  async getEndpoint(
    id: string,
    options: { includeSecret: boolean }
  ): Promise<WebhookEndpointDetail> {
    const [endpoint, stats] = await Promise.all([this.webhooks.getEndpoint(id), this.stats(id)])

    return {
      ...endpoint,
      secret: options.includeSecret ? endpoint.secret : '',
      stats: stats.get(id) ?? WebhookAdmin.emptyStats()
    }
  }

  async createEndpoint(input: WebhookEndpointInput, actor: Actor): Promise<WebhookEndpointRow> {
    const row = await this.webhooks.createEndpoint(input)
    await this.audit.log(actor, {
      action: 'webhook_endpoint.created',
      entityType: 'webhook_endpoint',
      entityId: row.id,
      summary: `Added webhook endpoint ${row.url}`,
      changes: { events: { from: null, to: row.events }, enabled: { from: null, to: row.enabled } }
    })

    return row
  }

  async updateEndpoint(
    id: string,
    input: WebhookEndpointUpdate,
    actor: Actor
  ): Promise<WebhookEndpointRow> {
    const before = await this.webhooks.getEndpoint(id)
    const row = await this.webhooks.updateEndpoint(id, input)
    const { secret: _a, ...beforeSafe } = before
    const { secret: _b, ...afterSafe } = row
    const changes = AuditLogger.diff(beforeSafe, afterSafe)

    if (Object.keys(changes).length) {
      const toggled = Object.keys(changes).length === 1 && 'enabled' in changes
      await this.audit.log(actor, {
        action: 'webhook_endpoint.updated',
        entityType: 'webhook_endpoint',
        entityId: id,
        summary: toggled
          ? `${row.enabled ? 'Enabled' : 'Disabled'} webhook endpoint ${row.url}`
          : `Updated webhook endpoint ${row.url}`,
        changes
      })
    }

    return row
  }

  async deleteEndpoint(id: string, actor: Actor): Promise<void> {
    const endpoint = await this.webhooks.getEndpoint(id)
    await this.webhooks.deleteEndpoint(id)
    await this.audit.log(actor, {
      action: 'webhook_endpoint.deleted',
      entityType: 'webhook_endpoint',
      entityId: id,
      summary: `Deleted webhook endpoint ${endpoint.url}`
    })
  }

  async rotateSecret(id: string, actor: Actor): Promise<WebhookEndpointRow> {
    const row = await this.webhooks.rotateSecret(id)
    await this.audit.log(actor, {
      action: 'webhook_endpoint.secret_rotated',
      entityType: 'webhook_endpoint',
      entityId: id,
      summary: `Rotated the signing secret of ${row.url}`
    })

    return row
  }

  async sendTest(id: string, actor: Actor): Promise<WebhookDeliveryRow> {
    const delivery = await this.webhooks.sendTest(id)
    await this.audit.log(actor, {
      action: 'webhook_endpoint.tested',
      entityType: 'webhook_endpoint',
      entityId: id,
      summary: 'Sent a test webhook event'
    })

    return delivery
  }

  // ---------------------------------------------------------------------------
  // Deliveries
  // ---------------------------------------------------------------------------
  async getDelivery(id: string) {
    const delivery = await this.db.query.webhookDeliveries.findFirst({
      where: and(this.scope.eq(webhookDeliveries.organizationId), eq(webhookDeliveries.id, id)),
      with: { endpoint: { columns: { id: true, url: true, enabled: true } } }
    })

    if (!delivery) throw new NotFoundError('Webhook delivery', id)

    return delivery
  }

  async redeliver(id: string, actor: Actor): Promise<WebhookDeliveryRow> {
    const delivery = await this.webhooks.redeliver(id)
    await this.audit.log(actor, {
      action: 'webhook_delivery.redelivered',
      entityType: 'webhook_delivery',
      entityId: id,
      summary: `Redelivered ${delivery.eventType} webhook`
    })

    return delivery
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------
  /**
   * Outcome counts over the last STATS_WINDOW deliveries of each endpoint of
   * the organization (index-backed lateral join).
   */
  private async stats(endpointId?: string): Promise<Map<string, EndpointStats>> {
    const result = await this.db.execute<StatsRow>(sql`
      select e.id as endpoint_id,
        count(d.status)::int as total,
        (count(*) filter (where d.status = 'success'))::int as success,
        (count(*) filter (where d.status = 'failed'))::int as failed,
        (count(*) filter (where d.status = 'pending'))::int as pending,
        max(d.created_at) as last_delivery_at
      from ${webhookEndpoints} e
      left join lateral (
        select status, created_at from ${webhookDeliveries} wd
        where wd.endpoint_id = e.id
        order by wd.created_at desc
        limit ${STATS_WINDOW}
      ) d on true
      where ${this.scope.sql('e')}
      ${endpointId ? sql`and e.id = ${endpointId}::uuid` : sql``}
      group by e.id
    `)

    return new Map(
      result.rows.map((row) => {
        const settled = row.success + row.failed

        return [
          row.endpoint_id,
          {
            total: row.total,
            success: row.success,
            failed: row.failed,
            pending: row.pending,
            successRate: settled ? row.success / settled : null,
            lastDeliveryAt: row.last_delivery_at ? new Date(row.last_delivery_at) : null
          }
        ]
      })
    )
  }

  private static emptyStats(): EndpointStats {
    return { total: 0, success: 0, failed: 0, pending: 0, successRate: null, lastDeliveryAt: null }
  }
}
