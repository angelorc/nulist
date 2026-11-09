import { sleep } from 'workflow'
import {
  deliverTransactionalStep,
  failTransactionalStep,
  planTransactionalStep
} from './steps/transactional'

/**
 * Delivers one transactional email: waits until `scheduledAt` when scheduled
 * (cancelling flips the status, which the delivery step re-checks), then
 * hands the stored content to the provider. When every retry fails the email
 * is marked failed.
 *
 * `organizationId` comes last so runs started before organizations existed
 * (`[messageId]`) replay unchanged; their steps resolve it from the message.
 */
export async function sendTransactionalWorkflow(messageId: string, organizationId?: string) {
  'use workflow'
  const plan = await planTransactionalStep(messageId, organizationId)

  if (plan.action === 'skip') return { messageId, status: plan.status, skipped: true }

  if (plan.delayMs > 0) await sleep(plan.delayMs)

  try {
    return await deliverTransactionalStep(messageId, organizationId)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)

    return await failTransactionalStep(messageId, message, organizationId)
  }
}
