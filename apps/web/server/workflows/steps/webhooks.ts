import type { WebhookDrainBatch } from '../../lib/webhooks/WebhookService'
import { useJobServices, useServices } from '../../utils/services'

/**
 * One HTTP attempt; the workflow owns the retry schedule, so the step itself never retries.
 * `organizationId` is absent for runs started before organizations existed.
 */
export async function attemptWebhookDeliveryStep(
  deliveryId: string,
  final: boolean,
  organizationId?: string
) {
  'use step'

  const services = await useJobServices(organizationId, 'webhookDelivery', deliveryId)

  return services.webhookService.attempt(deliveryId, final)
}

attemptWebhookDeliveryStep.maxRetries = 0

export async function drainWebhookBatchStep(
  endpointId: string,
  organizationId: string,
  owner: string
): Promise<WebhookDrainBatch> {
  'use step'

  return useServices().forOrganization(organizationId).webhookService.drainBatch(endpointId, owner)
}

drainWebhookBatchStep.maxRetries = 3

export async function releaseWebhookDrainStep(
  endpointId: string,
  organizationId: string,
  owner: string
): Promise<boolean> {
  'use step'

  return useServices()
    .forOrganization(organizationId)
    .webhookService.releaseDrain(endpointId, owner)
}

releaseWebhookDrainStep.maxRetries = 3

export async function continueWebhookDrainStep(
  endpointId: string,
  organizationId: string,
  owner: string
): Promise<string | null> {
  'use step'

  return useServices()
    .forOrganization(organizationId)
    .webhookService.continueDrain(endpointId, owner)
}

continueWebhookDrainStep.maxRetries = 3
