import { randomBytes, randomUUID } from 'node:crypto'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { Webhook } from 'standardwebhooks'
import type { Database } from '../../db/client'
import { webhookDeliveries, webhookEndpoints } from '../../db/schema'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import type { JobLauncher } from '../core/jobs'
import { InvalidStateError, NotFoundError } from '../core/errors'
import { toJsonObject } from '../core/json'
import { Page } from '../core/pagination'
import type { TenantScope } from '../core/TenantScope'
import type { OutboundHttpClient } from '../security/OutboundHttpClient'
import { BlockedTargetError, OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { WebhookDispatcher } from './WebhookDispatcher'

export interface EndpointInput {
  url: string
  description?: string | null
  events: string[]
  enabled?: boolean
}

export interface DeliveryQuery {
  page: number
  pageSize: number
  endpointId?: string
  status?: 'pending' | 'success' | 'failed'
}

export interface DeliveryAttempt {
  ok: boolean
  status: number | null
  /** Seconds suggested by the receiver (Retry-After) when it asked us to slow down. */
  retryAfter?: number
  /** Receiver asked us to stop (410 Gone) — the endpoint gets disabled. */
  gone?: boolean
}

const TIMEOUT_MS = 10_000
const MAX_BODY = 2_000

/**
 * Circuit breaker: after this many failed attempts in a row, attempts to the
 * endpoint are paused (no request; the workflow retries later) until
 * COOLDOWN_MS after the last failure, so a dead receiver never holds the
 * instance-wide workflow workers for a whole timeout per event.
 */
const FAILURE_THRESHOLD = 10
const COOLDOWN_MS = 5 * 60_000

type EndpointRow = typeof webhookEndpoints.$inferSelect

/**
 * The organization's outbound webhooks, following the Standard Webhooks spec
 * (webhook-id / webhook-timestamp / webhook-signature, `whsec_` secrets).
 * Deliveries belong to the organization of their endpoint.
 */
export class WebhookService implements WebhookDispatcher {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly jobs: JobLauncher,
    private readonly http: OutboundHttpClient,
    private readonly targets: OutboundTargetPolicy
  ) {}

  static generateSecret(): string {
    return `whsec_${randomBytes(32).toString('base64')}`
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------
  async listEndpoints() {
    return this.db
      .select()
      .from(webhookEndpoints)
      .where(this.scope.eq(webhookEndpoints.organizationId))
      .orderBy(desc(webhookEndpoints.createdAt))
  }

  async getEndpoint(id: string) {
    const [row] = await this.db.select().from(webhookEndpoints).where(this.endpointById(id))

    if (!row) throw new NotFoundError('Webhook endpoint', id)

    return row
  }

  async createEndpoint(input: EndpointInput) {
    await this.assertReachable(input.url)

    const [row] = await this.db
      .insert(webhookEndpoints)
      .values(
        this.scope.values({
          url: input.url,
          description: input.description ?? null,
          events: input.events,
          enabled: input.enabled ?? true,
          secret: WebhookService.generateSecret()
        })
      )
      .returning()

    if (!row) throw new InvalidStateError('Could not create the webhook endpoint')

    return row
  }

  async updateEndpoint(id: string, input: Partial<EndpointInput>) {
    if (input.url !== undefined) await this.assertReachable(input.url)

    // A new URL or a re-enabled endpoint starts with a closed circuit.
    const fresh = input.url !== undefined || input.enabled === true

    const [row] = await this.db
      .update(webhookEndpoints)
      .set({
        ...(input.url !== undefined && { url: input.url }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.events !== undefined && { events: input.events }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(fresh && { consecutiveFailures: 0, lastFailureAt: null })
      })
      .where(this.endpointById(id))
      .returning()

    if (!row) throw new NotFoundError('Webhook endpoint', id)

    return row
  }

  async rotateSecret(id: string) {
    const [row] = await this.db
      .update(webhookEndpoints)
      .set({ secret: WebhookService.generateSecret() })
      .where(this.endpointById(id))
      .returning()

    if (!row) throw new NotFoundError('Webhook endpoint', id)

    return row
  }

  async deleteEndpoint(id: string) {
    const rows = await this.db.delete(webhookEndpoints).where(this.endpointById(id)).returning()

    if (!rows.length) throw new NotFoundError('Webhook endpoint', id)
  }

  // ---------------------------------------------------------------------------
  // Dispatch & delivery
  // ---------------------------------------------------------------------------
  /** Fan out an event to every enabled endpoint subscribed to it (empty list = all events). */
  async dispatch<D extends object>(type: WebhookEventType, data: D): Promise<void> {
    const endpoints = (
      await this.db
        .select()
        .from(webhookEndpoints)
        .where(
          and(this.scope.eq(webhookEndpoints.organizationId), eq(webhookEndpoints.enabled, true))
        )
    ).filter((e) => e.events.length === 0 || e.events.includes(type))

    if (!endpoints.length) return
    const payload = { type, timestamp: new Date().toISOString(), data: toJsonObject(data) }

    const rows = await this.db
      .insert(webhookDeliveries)
      .values(
        this.scope.valuesMany(
          endpoints.map((e) => ({ endpointId: e.id, eventType: type, payload }))
        )
      )
      .returning({ id: webhookDeliveries.id })

    await Promise.all(rows.map((r) => this.jobs.deliverWebhook(this.scope.organizationId, r.id)))
  }

  /** Queue a synthetic event to verify an endpoint. */
  async sendTest(endpointId: string) {
    const endpoint = await this.getEndpoint(endpointId)

    const [row] = await this.db
      .insert(webhookDeliveries)
      .values(
        this.scope.values({
          endpointId: endpoint.id,
          eventType: 'email.sent',
          payload: {
            type: 'email.sent',
            timestamp: new Date().toISOString(),
            data: { test: true, id: randomUUID(), to: 'test@example.com' }
          }
        })
      )
      .returning()

    if (!row) throw new InvalidStateError('Could not queue the test delivery')
    // A manual test always probes the receiver, even while the circuit is open.
    await this.closeCircuit(endpoint.id)
    await this.jobs.deliverWebhook(this.scope.organizationId, row.id)

    return row
  }

  async redeliver(deliveryId: string) {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({ status: 'pending' })
      .where(this.deliveryById(deliveryId))
      .returning()

    if (!row) throw new NotFoundError('Webhook delivery', deliveryId)
    await this.closeCircuit(row.endpointId)
    await this.jobs.deliverWebhook(this.scope.organizationId, row.id)

    return row
  }

  /** Performs one HTTP attempt and records the outcome. Retries are driven by the workflow. */
  async attempt(deliveryId: string, final = false): Promise<DeliveryAttempt> {
    const [delivery] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(this.deliveryById(deliveryId))

    if (!delivery || delivery.status === 'success')
      return { ok: true, status: delivery?.responseStatus ?? null }
    const endpoint = await this.getEndpoint(delivery.endpointId)

    if (!endpoint.enabled) {
      await this.db
        .update(webhookDeliveries)
        .set({ status: 'failed', responseBody: 'Endpoint disabled' })
        .where(this.deliveryById(deliveryId))

      return { ok: true, status: null }
    }

    if (WebhookService.circuitOpen(endpoint)) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: final ? 'failed' : 'pending',
          responseStatus: null,
          responseBody: `Paused: the endpoint failed ${endpoint.consecutiveFailures} times in a row`,
          lastAttemptAt: new Date()
        })
        .where(this.deliveryById(deliveryId))

      return { ok: false, status: null }
    }

    const body = JSON.stringify(delivery.payload)
    const signedAt = new Date()
    const signature = new Webhook(endpoint.secret).sign(delivery.id, signedAt, body)
    const started = Date.now()
    let status: number | null = null
    let responseBody = ''
    let retryAfter: number | undefined

    try {
      const response = await this.http.post(endpoint.url, {
        headers: {
          'content-type': 'application/json',
          'user-agent': 'mlist-webhooks/1.0',
          'webhook-id': delivery.id,
          'webhook-timestamp': String(Math.floor(signedAt.getTime() / 1000)),
          'webhook-signature': signature
        },
        body,
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_BODY
      })

      status = response.status
      responseBody = response.body.slice(0, MAX_BODY)

      if (response.retryAfter && /^\d+$/.test(response.retryAfter))
        retryAfter = Number(response.retryAfter)
    } catch (cause) {
      responseBody = cause instanceof Error ? cause.message : 'Request failed'
    }

    const ok = status !== null && status >= 200 && status < 300
    const gone = status === 410
    await this.recordOutcome(endpoint.id, ok)
    await this.db
      .update(webhookDeliveries)
      .set({
        status: ok ? 'success' : final || gone ? 'failed' : 'pending',
        attempts: delivery.attempts + 1,
        responseStatus: status,
        responseBody,
        durationMs: Date.now() - started,
        lastAttemptAt: new Date()
      })
      .where(this.deliveryById(deliveryId))

    if (gone) await this.updateEndpoint(endpoint.id, { enabled: false })

    return { ok, status, retryAfter, gone }
  }

  async markFailed(deliveryId: string) {
    await this.db
      .update(webhookDeliveries)
      .set({ status: 'failed' })
      .where(this.deliveryById(deliveryId))
  }

  async listDeliveries(query: DeliveryQuery) {
    const page = Page.from(query)

    const where = and(
      this.scope.eq(webhookDeliveries.organizationId),
      query.endpointId ? eq(webhookDeliveries.endpointId, query.endpointId) : undefined,
      query.status ? eq(webhookDeliveries.status, query.status) : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db.query.webhookDeliveries.findMany({
        where,
        with: { endpoint: { columns: { id: true, url: true } } },
        orderBy: desc(webhookDeliveries.createdAt),
        limit: page.limit,
        offset: page.offset
      }),
      this.db.select({ value: count() }).from(webhookDeliveries).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  /** Refuses URLs that resolve to the instance's own network (loopback, private, metadata). */
  private async assertReachable(url: string): Promise<void> {
    const target = OutboundTargetPolicy.targetOf(new URL(url))

    if ((await this.targets.check(target)) === 'blocked') throw new BlockedTargetError(target.host)
  }

  private static circuitOpen(endpoint: EndpointRow): boolean {
    return (
      endpoint.consecutiveFailures >= FAILURE_THRESHOLD &&
      endpoint.lastFailureAt !== null &&
      Date.now() - endpoint.lastFailureAt.getTime() < COOLDOWN_MS
    )
  }

  /** Counts failures in a row; one success closes the circuit. */
  private async recordOutcome(endpointId: string, ok: boolean): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set(
        ok
          ? { consecutiveFailures: 0, lastFailureAt: null }
          : {
              consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
              lastFailureAt: new Date()
            }
      )
      .where(this.endpointById(endpointId))
  }

  private async closeCircuit(endpointId: string): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 0, lastFailureAt: null })
      .where(this.endpointById(endpointId))
  }

  private endpointById(id: string) {
    return and(this.scope.eq(webhookEndpoints.organizationId), eq(webhookEndpoints.id, id))
  }

  private deliveryById(id: string) {
    return and(this.scope.eq(webhookDeliveries.organizationId), eq(webhookDeliveries.id, id))
  }
}
