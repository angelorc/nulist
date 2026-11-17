import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Executor } from '../../db/client'
import type { JsonObject } from '../../../shared/types/domain'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import { toJsonObject } from '../core/json'

/**
 * Anything that wants to notify the organization's endpoints about domain events.
 * `data` is any JSON-serializable object (sent as JSON).
 */
export interface WebhookDispatcher {
  dispatch<D extends object>(type: WebhookEventType, data: D): Promise<void>
  enqueue(tx: Executor, type: WebhookEventType, dataQuery: SQL): Promise<void>
  wake(endpointIds?: string[]): Promise<void>
}

export interface DispatchedEvent {
  type: WebhookEventType
  data: JsonObject
}

export class NullWebhookDispatcher implements WebhookDispatcher {
  readonly dispatched: DispatchedEvent[] = []

  async dispatch<D extends object>(type: WebhookEventType, data: D) {
    this.dispatched.push({ type, data: toJsonObject(data) })
  }

  async enqueue(tx: Executor, type: WebhookEventType, dataQuery: SQL) {
    const rows = await tx.execute<{ data: JsonObject }>(
      sql`select events.data from (${dataQuery}) events`
    )

    for (const row of rows.rows) this.dispatched.push({ type, data: row.data })
  }

  async wake() {}
}
