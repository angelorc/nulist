import { FatalError, RetryableError, getStepMetadata } from 'workflow'
import { DomainError, ProviderError } from '../../lib/core/errors'
import type { DeliveryPlan, DeliveryResult } from '../../lib/transactional/TransactionalService'
import { useJobServices } from '../../utils/services'

/** Wait before retry N (1-based) after a retryable provider error (throttling, outages). */
const RETRY_BACKOFF = ['10s', '1m', '5m', '15m', '1h'] as const

/** Domain errors (missing message…) will not fix themselves: fail without retrying. */
function fatalOnDomainError(cause: unknown): never {
  if (cause instanceof DomainError && !(cause instanceof ProviderError && cause.retryable))
    throw new FatalError(cause.message)
  throw cause
}

/**
 * Reads the message and decides whether (and when) to deliver it. Every step
 * runs in the message's organization (`organizationId`, or resolved from the
 * message for runs started before organizations existed).
 */
export async function planTransactionalStep(
  messageId: string,
  organizationId?: string
): Promise<DeliveryPlan> {
  'use step'

  try {
    return await (
      await useJobServices(organizationId, 'message', messageId)
    ).transactional.plan(messageId)
  } catch (cause) {
    return fatalOnDomainError(cause)
  }
}

planTransactionalStep.maxRetries = 3

/** One delivery attempt. Retryable provider errors are retried with backoff (5 retries). */
export async function deliverTransactionalStep(
  messageId: string,
  organizationId?: string
): Promise<DeliveryResult> {
  'use step'

  try {
    return await (
      await useJobServices(organizationId, 'message', messageId)
    ).transactional.deliver(messageId)
  } catch (cause) {
    if (cause instanceof ProviderError && cause.retryable) {
      const { attempt } = getStepMetadata()

      const retryAfter =
        RETRY_BACKOFF[Math.min(Math.max(attempt, 1), RETRY_BACKOFF.length) - 1] ?? '1h'

      throw new RetryableError(cause.message, { retryAfter })
    }

    return fatalOnDomainError(cause)
  }
}

deliverTransactionalStep.maxRetries = 5

/** Records the permanent failure (status, `failed` event, `email.failed` webhook). */
export async function failTransactionalStep(
  messageId: string,
  error: string,
  organizationId?: string
): Promise<DeliveryResult> {
  'use step'

  return (await useJobServices(organizationId, 'message', messageId)).transactional.fail(
    messageId,
    error
  )
}

failTransactionalStep.maxRetries = 5
