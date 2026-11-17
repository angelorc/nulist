import { randomBytes, randomUUID } from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  ne,
  notExists,
  or,
  sql
} from 'drizzle-orm'
import type { Column, SQL } from 'drizzle-orm'
import { Webhook } from 'standardwebhooks'
import type { Database, Executor } from '../../db/client'
import { webhookDeliveries, webhookEndpoints } from '../../db/schema'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import type { JobLauncher } from '../core/jobs'
import { InvalidStateError, NotFoundError } from '../core/errors'
import { toJsonObject } from '../core/json'
import { mapLimit } from '../core/mapLimit'
import { Page } from '../core/pagination'
import type { TenantScope } from '../core/TenantScope'
import type { OutboundHttpClient } from '../security/OutboundHttpClient'
import { BlockedTargetError, OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { WebhookDispatcher } from './WebhookDispatcher'
import { WebhookRetryPolicy } from './WebhookRetryPolicy'

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

export interface WebhookDrainBatch {
  owned: boolean
  processed: number
  nextDueAt: string | null
  disabled: boolean
}

const TIMEOUT_MS = 10_000
const MAX_BODY = 2_000
const DRAIN_BATCH = 25
const DRAIN_CONCURRENCY = 5
const CLAIM_SECONDS = 300
const LEASE_SECONDS = 600
const MAX_IDLE_SECONDS = 240

/**
 * Circuit breaker: after this many failed attempts in a row, attempts to the
 * endpoint are paused (no request; the workflow retries later) until
 * COOLDOWN_MS after the last failure, so a dead receiver never holds the
 * instance-wide workflow workers for a whole timeout per event.
 */
const FAILURE_THRESHOLD = 10
const COOLDOWN_MS = 5 * 60_000

type EndpointRow = typeof webhookEndpoints.$inferSelect

type DeliveryRow = typeof webhookDeliveries.$inferSelect

interface DrainLease {
  id: string
  owner: string
}

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

  static drainToken(owner: string): string {
    return `webhook-drain:${owner}`
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

    if (input.enabled === false) await this.failPending(row.id)

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

    await this.db.insert(webhookDeliveries).values(
      this.scope.valuesMany(
        endpoints.map((e) => ({
          endpointId: e.id,
          eventType: type,
          payload,
          nextAttemptAt: sql`now()`
        }))
      )
    )

    await this.wake(endpoints.map((e) => e.id))
  }

  async enqueue(tx: Executor, type: WebhookEventType, dataQuery: SQL): Promise<void> {
    const timestamp = new Date().toISOString()

    await tx.execute(sql`
      insert into ${webhookDeliveries}
        (organization_id, endpoint_id, event_type, payload, next_attempt_at)
      select ${this.scope.id}, e.id, ${type}::text,
        jsonb_build_object('type', ${type}::text, 'timestamp', ${timestamp}::text, 'data', events.data),
        now()
      from (${dataQuery}) events
      cross join ${webhookEndpoints} e
      where ${this.scope.sql('e')} and e.enabled
        and (cardinality(e.events) = 0 or ${type}::text = any(e.events))`)
  }

  async wake(endpointIds?: string[]): Promise<void> {
    if (endpointIds?.length === 0) return
    const claimed = await this.claimLease(endpointIds)

    await Promise.all(claimed.map((lease) => this.launchDrain(lease.id, lease.owner)))

    const sleeping = await this.interruptSleep(endpointIds)

    await Promise.all(sleeping.map((owner) => this.resumeDrain(owner)))
  }

  async drainBatch(endpointId: string, owner: string): Promise<WebhookDrainBatch> {
    const endpoint = await this.renewLease(endpointId, owner)

    if (!endpoint) return { owned: false, processed: 0, nextDueAt: null, disabled: false }

    if (!endpoint.enabled) {
      await this.failPending(endpoint.id)

      return { owned: true, processed: 0, nextDueAt: null, disabled: true }
    }

    if (WebhookService.circuitOpen(endpoint)) return this.idle(endpoint, owner)

    const due = await this.claimDue(endpoint.id)

    if (!due.length) return this.idle(endpoint, owner)

    const outcomes = await mapLimit(due, DRAIN_CONCURRENCY, (delivery) =>
      this.deliverClaimed(delivery)
    )

    const renewed = await this.renewLease(endpoint.id, owner)

    if (!renewed) return { owned: false, processed: due.length, nextDueAt: null, disabled: false }

    if (!renewed.enabled || outcomes.some((outcome) => outcome.gone))
      return { owned: true, processed: due.length, nextDueAt: null, disabled: true }

    return {
      owned: true,
      processed: due.length,
      nextDueAt: await this.nextDueAt(renewed),
      disabled: false
    }
  }

  async releaseDrain(endpointId: string, owner: string): Promise<boolean> {
    const released = await this.db
      .update(webhookEndpoints)
      .set({
        drainLeaseUntil: null,
        drainLeaseOwner: null,
        drainSleepUntil: null,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(
        and(
          this.leaseOf(endpointId, owner),
          or(eq(webhookEndpoints.enabled, false), notExists(this.pendingOf(webhookEndpoints.id)))
        )
      )
      .returning({ id: webhookEndpoints.id })

    if (released.length) return false

    return (await this.renewLease(endpointId, owner)) !== undefined
  }

  async continueDrain(endpointId: string, owner: string): Promise<string | null> {
    const [lease] = await this.db
      .update(webhookEndpoints)
      .set({
        drainLeaseUntil: WebhookService.leaseExpiry(),
        drainLeaseOwner: sql`gen_random_uuid()`,
        drainSleepUntil: null,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(this.leaseOf(endpointId, owner))
      .returning({ owner: sql<string>`${webhookEndpoints.drainLeaseOwner}` })

    if (!lease) return null

    return this.launchDrain(endpointId, lease.owner)
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
          },
          nextAttemptAt: sql`now()`
        })
      )
      .returning()

    if (!row) throw new InvalidStateError('Could not queue the test delivery')
    await this.deliverSoon(endpoint)

    return row
  }

  async redeliver(deliveryId: string) {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({ status: 'pending', scheduleAttempts: 0, nextAttemptAt: sql`now()` })
      .where(this.deliveryById(deliveryId))
      .returning()

    if (!row) throw new NotFoundError('Webhook delivery', deliveryId)
    await this.deliverSoon(await this.getEndpoint(row.endpointId))

    return row
  }

  /** Performs one HTTP attempt and records the outcome. Retries are driven by the workflow. */
  async attempt(deliveryId: string, final = false): Promise<DeliveryAttempt> {
    const [delivery] = await this.db
      .update(webhookDeliveries)
      .set(WebhookService.countedAttempt())
      .where(and(this.deliveryById(deliveryId), ne(webhookDeliveries.status, 'success')))
      .returning()

    if (!delivery) return { ok: true, status: null }

    return this.deliver(delivery, final, false)
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

  private async deliver(
    delivery: DeliveryRow,
    final: boolean,
    reschedule: boolean
  ): Promise<DeliveryAttempt> {
    const endpoint = await this.getEndpoint(delivery.endpointId)

    if (!endpoint.enabled) {
      await this.db
        .update(webhookDeliveries)
        .set({ status: 'failed', responseBody: 'Endpoint disabled', nextAttemptAt: null })
        .where(this.deliveryById(delivery.id))

      return { ok: true, status: null }
    }

    if (WebhookService.circuitOpen(endpoint)) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: final ? 'failed' : 'pending',
          attempts: delivery.attempts - 1,
          scheduleAttempts: delivery.scheduleAttempts - 1,
          responseStatus: null,
          responseBody: `Paused: the endpoint failed ${endpoint.consecutiveFailures} times in a row`,
          lastAttemptAt: new Date(),
          nextAttemptAt: reschedule && !final ? WebhookService.cooldownEnd(endpoint) : null
        })
        .where(this.deliveryById(delivery.id))

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
          'user-agent': 'nulist-webhooks/1.0',
          'webhook-id': delivery.id,
          'webhook-timestamp': String(Math.floor(signedAt.getTime() / 1000)),
          'webhook-signature': signature
        },
        body,
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_BODY
      })

      status = response.status
      responseBody = response.body.replaceAll('\u0000', '').slice(0, MAX_BODY)

      if (response.retryAfter && /^\d+$/.test(response.retryAfter))
        retryAfter = Number(response.retryAfter)
    } catch (cause) {
      responseBody = cause instanceof Error ? cause.message : 'Request failed'
    }

    const ok = status !== null && status >= 200 && status < 300
    const gone = status === 410
    const retry = !ok && !final && !gone
    await this.recordOutcome(endpoint.id, ok)
    await this.db
      .update(webhookDeliveries)
      .set({
        status: ok ? 'success' : retry ? 'pending' : 'failed',
        responseStatus: status,
        responseBody,
        durationMs: Date.now() - started,
        lastAttemptAt: new Date(),
        nextAttemptAt:
          reschedule && retry
            ? sql`now() + make_interval(secs => ${WebhookRetryPolicy.delaySeconds(delivery.scheduleAttempts - 1, retryAfter)})`
            : null
      })
      .where(this.deliveryById(delivery.id))

    if (gone) await this.updateEndpoint(endpoint.id, { enabled: false })

    return { ok, status, retryAfter, gone }
  }

  private async deliverClaimed(delivery: DeliveryRow): Promise<DeliveryAttempt> {
    const tried = delivery.scheduleAttempts - 1

    try {
      if (!WebhookRetryPolicy.exhausted(tried))
        return await this.deliver(delivery, WebhookRetryPolicy.isFinal(tried), true)

      await this.db
        .update(webhookDeliveries)
        .set({ status: 'failed', nextAttemptAt: null })
        .where(this.deliveryById(delivery.id))
    } catch (error) {
      console.error(`[webhooks] could not record the delivery ${delivery.id}`, error)
    }

    return { ok: false, status: null }
  }

  private async claimLease(endpointIds?: string[]): Promise<DrainLease[]> {
    return this.db
      .update(webhookEndpoints)
      .set({
        drainLeaseUntil: WebhookService.leaseExpiry(),
        drainLeaseOwner: sql`gen_random_uuid()`,
        drainSleepUntil: null,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(
        and(
          this.scope.eq(webhookEndpoints.organizationId),
          endpointIds ? inArray(webhookEndpoints.id, endpointIds) : undefined,
          eq(webhookEndpoints.enabled, true),
          or(
            isNull(webhookEndpoints.drainLeaseUntil),
            lt(webhookEndpoints.drainLeaseUntil, sql`now()`)
          ),
          exists(this.pendingOf(webhookEndpoints.id))
        )
      )
      .returning({
        id: webhookEndpoints.id,
        owner: sql<string>`${webhookEndpoints.drainLeaseOwner}`
      })
  }

  private async interruptSleep(endpointIds?: string[]): Promise<string[]> {
    const due = this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, webhookEndpoints.id),
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextAttemptAt, sql`now()`)
        )
      )

    const rows = await this.db
      .update(webhookEndpoints)
      .set({ drainSleepUntil: null, updatedAt: sql`${webhookEndpoints.updatedAt}` })
      .where(
        and(
          this.scope.eq(webhookEndpoints.organizationId),
          endpointIds ? inArray(webhookEndpoints.id, endpointIds) : undefined,
          eq(webhookEndpoints.enabled, true),
          gt(webhookEndpoints.drainLeaseUntil, sql`now()`),
          gt(webhookEndpoints.drainSleepUntil, sql`now()`),
          or(
            lt(webhookEndpoints.consecutiveFailures, FAILURE_THRESHOLD),
            isNull(webhookEndpoints.lastFailureAt),
            lte(
              webhookEndpoints.lastFailureAt,
              sql`now() - make_interval(secs => ${COOLDOWN_MS / 1000})`
            )
          ),
          exists(due)
        )
      )
      .returning({ owner: sql<string>`${webhookEndpoints.drainLeaseOwner}` })

    return rows.map((row) => row.owner)
  }

  private async launchDrain(endpointId: string, owner: string): Promise<string | null> {
    try {
      return await this.jobs.drainWebhookEndpoint(this.scope.organizationId, endpointId, owner)
    } catch (error) {
      console.error(`[webhooks] could not start the delivery to endpoint ${endpointId}`, error)
      await this.releaseLease(endpointId, owner)

      return null
    }
  }

  private async resumeDrain(owner: string): Promise<void> {
    try {
      await this.jobs.resumeHook(WebhookService.drainToken(owner), {
        wokenAt: new Date().toISOString()
      })
    } catch (error) {
      console.error(`[webhooks] could not wake the delivery run ${owner}`, error)
    }
  }

  private async idle(endpoint: EndpointRow, owner: string): Promise<WebhookDrainBatch> {
    await this.db
      .update(webhookEndpoints)
      .set({
        drainSleepUntil: sql`now() + make_interval(secs => ${MAX_IDLE_SECONDS})`,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(this.leaseOf(endpoint.id, owner))

    return { owned: true, processed: 0, nextDueAt: await this.nextDueAt(endpoint), disabled: false }
  }

  private async renewLease(endpointId: string, owner: string): Promise<EndpointRow | undefined> {
    const [row] = await this.db
      .update(webhookEndpoints)
      .set({
        drainLeaseUntil: WebhookService.leaseExpiry(),
        drainSleepUntil: null,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(this.leaseOf(endpointId, owner))
      .returning()

    return row
  }

  private async releaseLease(endpointId: string, owner: string): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set({
        drainLeaseUntil: null,
        drainLeaseOwner: null,
        drainSleepUntil: null,
        updatedAt: sql`${webhookEndpoints.updatedAt}`
      })
      .where(this.leaseOf(endpointId, owner))
  }

  private async claimDue(endpointId: string): Promise<DeliveryRow[]> {
    const due = this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          this.scope.eq(webhookDeliveries.organizationId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextAttemptAt, sql`now()`)
        )
      )
      .orderBy(asc(webhookDeliveries.createdAt))
      .limit(DRAIN_BATCH)
      .for('update', { skipLocked: true })

    const rows = await this.db
      .update(webhookDeliveries)
      .set({
        ...WebhookService.countedAttempt(),
        nextAttemptAt: sql`now() + make_interval(secs => ${CLAIM_SECONDS})`
      })
      .where(inArray(webhookDeliveries.id, due))
      .returning()

    return rows.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  private async nextDueAt(endpoint: EndpointRow): Promise<string | null> {
    const [row] = await this.db
      .select({ at: min(webhookDeliveries.nextAttemptAt) })
      .from(webhookDeliveries)
      .where(
        and(
          this.scope.eq(webhookDeliveries.organizationId),
          eq(webhookDeliveries.endpointId, endpoint.id),
          eq(webhookDeliveries.status, 'pending')
        )
      )

    if (!row?.at) return null

    const resumeAt = WebhookService.circuitOpen(endpoint)
      ? Math.max(row.at.getTime(), WebhookService.cooldownEnd(endpoint).getTime())
      : row.at.getTime()

    return new Date(Math.min(resumeAt, Date.now() + MAX_IDLE_SECONDS * 1000)).toISOString()
  }

  private async failPending(endpointId: string): Promise<void> {
    await this.db
      .update(webhookDeliveries)
      .set({ status: 'failed', responseBody: 'Endpoint disabled', nextAttemptAt: null })
      .where(
        and(
          this.scope.eq(webhookDeliveries.organizationId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.status, 'pending')
        )
      )
  }

  private async deliverSoon(endpoint: EndpointRow): Promise<void> {
    if (!endpoint.enabled) return this.failPending(endpoint.id)

    await this.closeCircuit(endpoint.id)
    await this.wake([endpoint.id])
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

  private static cooldownEnd(endpoint: EndpointRow): Date {
    return new Date((endpoint.lastFailureAt?.getTime() ?? Date.now()) + COOLDOWN_MS)
  }

  private static leaseExpiry(): SQL {
    return sql`now() + make_interval(secs => ${LEASE_SECONDS})`
  }

  private static countedAttempt() {
    return {
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      scheduleAttempts: sql`${webhookDeliveries.scheduleAttempts} + 1`
    }
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

  private pendingOf(endpointId: Column) {
    return this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.status, 'pending'),
          isNotNull(webhookDeliveries.nextAttemptAt)
        )
      )
  }

  private leaseOf(endpointId: string, owner: string) {
    return and(this.endpointById(endpointId), eq(webhookEndpoints.drainLeaseOwner, owner))
  }

  private endpointById(id: string) {
    return and(this.scope.eq(webhookEndpoints.organizationId), eq(webhookEndpoints.id, id))
  }

  private deliveryById(id: string) {
    return and(this.scope.eq(webhookDeliveries.organizationId), eq(webhookDeliveries.id, id))
  }
}
