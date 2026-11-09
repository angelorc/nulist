import { FatalError, getStepMetadata } from 'workflow'
import { DomainError, NotFoundError, ProviderError } from '../../lib/core/errors'
import type { OptInDispatch, OptInService } from '../../lib/optin/OptInService'
import { useJobServices } from '../../utils/services'

const SEND_RETRIES = 5

/** Retryable provider errors are retried; other domain errors fail the step for good. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ProviderError && error.retryable) throw error

    if (error instanceof DomainError) throw new FatalError(error.message)
    throw error
  }
}

/** The last retry turns a still-retryable provider error into a recorded failure. */
function isFinalAttempt(maxRetries: number): boolean {
  return getStepMetadata().attempt > maxRetries
}

/**
 * The opt-in service of the run's organization. Runs started before
 * organizations existed carry no id and resolve it from the contact; null when
 * that contact was deleted since (its pending subscription is gone with it).
 */
async function optInOf(
  organizationId: string | undefined,
  contactId: string
): Promise<OptInService | null> {
  try {
    return (await useJobServices(organizationId, 'contact', contactId)).optIn
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

/** Sends the confirmation email. Returns the configured expiry so the workflow can schedule. */
export async function sendOptInConfirmationStep(
  contactId: string,
  listId: string,
  organizationId?: string
): Promise<OptInDispatch> {
  'use step'

  return guarded(async () => {
    const optIn = await optInOf(organizationId, contactId)

    if (!optIn) return { status: 'skipped', reason: 'not_pending', expiryDays: 0 }

    return optIn.sendConfirmation(contactId, listId, {
      finalAttempt: isFinalAttempt(SEND_RETRIES)
    })
  })
}

sendOptInConfirmationStep.maxRetries = SEND_RETRIES

/** Sends the single reminder with a link valid for the days left before expiry. */
export async function sendOptInReminderStep(
  contactId: string,
  listId: string,
  expiresInDays: number,
  organizationId?: string
): Promise<OptInDispatch> {
  'use step'

  return guarded(async () => {
    const optIn = await optInOf(organizationId, contactId)

    if (!optIn) return { status: 'skipped', reason: 'not_pending', expiryDays: expiresInDays }

    return optIn.sendReminder(contactId, listId, {
      finalAttempt: isFinalAttempt(SEND_RETRIES),
      expiresInDays
    })
  })
}

sendOptInReminderStep.maxRetries = SEND_RETRIES

/** Drops the subscription if it is still unconfirmed. */
export async function expireOptInStep(
  contactId: string,
  listId: string,
  organizationId?: string
): Promise<{ expired: boolean }> {
  'use step'

  return guarded(async () => {
    const optIn = await optInOf(organizationId, contactId)

    return optIn ? optIn.expire(contactId, listId) : { expired: false }
  })
}

expireOptInStep.maxRetries = 5
