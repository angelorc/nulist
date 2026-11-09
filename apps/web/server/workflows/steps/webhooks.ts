import { useJobServices } from '../../utils/services'

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
