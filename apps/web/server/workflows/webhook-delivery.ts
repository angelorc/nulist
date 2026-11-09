import { sleep } from 'workflow'
import { attemptWebhookDeliveryStep } from './steps/webhooks'

/** Standard Webhooks style retry schedule (~1 day in total). */
const BACKOFF = ['5s', '1m', '10m', '1h', '4h', '12h'] as const

/**
 * Delivers one outbound webhook of an organization with durable exponential
 * backoff. Honors Retry-After and stops on 2xx or 410 Gone. The organization is
 * the last argument: runs started before organizations existed have none.
 */
export async function deliverWebhookWorkflow(deliveryId: string, organizationId?: string) {
  'use workflow'

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    const final = attempt === BACKOFF.length
    const result = await attemptWebhookDeliveryStep(deliveryId, final, organizationId)

    if (result.ok || result.gone || final) return result
    await sleep(result.retryAfter ? `${Math.min(result.retryAfter, 86_400)}s` : BACKOFF[attempt]!)
  }

  return { ok: false, status: null }
}
