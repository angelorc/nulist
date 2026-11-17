import { sleep } from 'workflow'
import { WebhookRetryPolicy } from '../lib/webhooks/WebhookRetryPolicy'
import { attemptWebhookDeliveryStep } from './steps/webhooks'

/**
 * Delivers one outbound webhook of an organization with durable exponential
 * backoff. Honors Retry-After and stops on 2xx or 410 Gone. The organization is
 * the last argument: runs started before organizations existed have none.
 */
export async function deliverWebhookWorkflow(deliveryId: string, organizationId?: string) {
  'use workflow'

  for (let attempt = 0; ; attempt++) {
    const final = WebhookRetryPolicy.isFinal(attempt)
    const result = await attemptWebhookDeliveryStep(deliveryId, final, organizationId)

    if (result.ok || result.gone || final) return result
    await sleep(`${WebhookRetryPolicy.delaySeconds(attempt, result.retryAfter)}s`)
  }
}
