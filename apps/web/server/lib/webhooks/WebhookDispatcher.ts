import type { JsonObject } from '../../../shared/types/domain'
import type { WebhookEventType } from '../../../shared/utils/webhook-events'
import { toJsonObject } from '../core/json'

/**
 * Anything that wants to notify the organization's endpoints about domain events.
 * `data` is any JSON-serializable object (sent as JSON).
 */
export interface WebhookDispatcher {
  dispatch<D extends object>(type: WebhookEventType, data: D): Promise<void>
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
}
