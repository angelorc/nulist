import { FatalError } from 'workflow'
import type {
  BroadcastBatchResult,
  BroadcastBeginResult,
  BroadcastCompletion,
  BroadcastSendPlan
} from '../../../shared/types/broadcasts'
import type { BroadcastStatus } from '../../../shared/types/domain'
import { DomainError, ProviderError } from '../../lib/core/errors'
import { useJobServices } from '../../utils/services'

/** Domain errors (missing broadcast, broken template…) will not fix themselves: fail fast. */
async function fatalOnDomainError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof DomainError && !(error instanceof ProviderError && error.retryable))
      throw new FatalError(error.message)
    throw error
  }
}

/** Current status, when to start and how many messages per batch. */
export async function loadBroadcastStep(
  broadcastId: string,
  organizationId?: string
): Promise<BroadcastSendPlan> {
  'use step'

  return fatalOnDomainError(async () =>
    (await useJobServices(organizationId, 'broadcast', broadcastId)).broadcasts.plan(broadcastId)
  )
}

loadBroadcastStep.maxRetries = 3

/** Freezes the content and queues one message per recipient (idempotent). */
export async function beginBroadcastStep(
  broadcastId: string,
  organizationId?: string
): Promise<BroadcastBeginResult> {
  'use step'

  return fatalOnDomainError(async () =>
    (await useJobServices(organizationId, 'broadcast', broadcastId)).broadcasts.begin(broadcastId)
  )
}

beginBroadcastStep.maxRetries = 3

/** Sends one throttled batch; claimed messages are released on failure, so retries are safe. */
export async function sendBroadcastBatchStep(
  broadcastId: string,
  size: number,
  organizationId?: string
): Promise<BroadcastBatchResult> {
  'use step'

  return fatalOnDomainError(async () =>
    (await useJobServices(organizationId, 'broadcast', broadcastId)).broadcasts.sendBatch(
      broadcastId,
      size
    )
  )
}

sendBroadcastBatchStep.maxRetries = 5

export async function broadcastStatusStep(
  broadcastId: string,
  organizationId?: string
): Promise<BroadcastStatus> {
  'use step'

  return fatalOnDomainError(async () =>
    (await useJobServices(organizationId, 'broadcast', broadcastId)).broadcasts.status(broadcastId)
  )
}

broadcastStatusStep.maxRetries = 3

export async function completeBroadcastStep(
  broadcastId: string,
  organizationId?: string
): Promise<BroadcastCompletion> {
  'use step'

  return (await useJobServices(organizationId, 'broadcast', broadcastId)).broadcasts.complete(
    broadcastId
  )
}

completeBroadcastStep.maxRetries = 5

export async function failBroadcastStep(
  broadcastId: string,
  error: string,
  organizationId?: string
): Promise<void> {
  'use step'
  await (
    await useJobServices(organizationId, 'broadcast', broadcastId)
  ).broadcasts.fail(broadcastId, error)
}

failBroadcastStep.maxRetries = 5

/** Starts a fresh run that picks up where this one stopped (bounded event log per run). */
export async function continueBroadcastStep(
  broadcastId: string,
  organizationId?: string
): Promise<string> {
  'use step'

  return (
    await useJobServices(organizationId, 'broadcast', broadcastId)
  ).broadcasts.continueInNewRun(broadcastId)
}

continueBroadcastStep.maxRetries = 3
