import { FatalError, createHook, sleep } from 'workflow'
import {
  beginBroadcastStep,
  broadcastStatusStep,
  completeBroadcastStep,
  continueBroadcastStep,
  failBroadcastStep,
  loadBroadcastStep,
  sendBroadcastBatchStep
} from './steps/broadcast'

/**
 * Loop iterations before the send continues in a fresh run. Each iteration adds
 * a handful of events (step + optional sleep/hook), which keeps a run far below
 * the 25k events limit even for multi-million recipient audiences.
 */
const MAX_ITERATIONS_PER_RUN = 3000

/** Backoff when the daily/monthly send limit is used up, and when the provider throttles. */
const LIMITED_BACKOFF = '30m'
const THROTTLED_BACKOFF = '30s'

/**
 * Sends a broadcast durably: waits for the scheduled time, queues the recipients,
 * then delivers throttled batches until none are left. Pausing parks the run on
 * a hook (`broadcast:<id>:resume`) until BroadcastService.resume() wakes it.
 */
export async function sendBroadcastWorkflow(broadcastId: string, organizationId?: string) {
  'use workflow'

  try {
    const plan = await loadBroadcastStep(broadcastId, organizationId)

    if (plan.sleepUntil) await sleep(new Date(plan.sleepUntil))

    const begun = await beginBroadcastStep(broadcastId, organizationId)

    if (begun.state === 'cancelled') return { status: 'cancelled' as const }

    if (begun.state === 'finished') return { status: 'finished' as const }

    let sent = 0

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_RUN; iteration++) {
      const batch = await sendBroadcastBatchStep(broadcastId, plan.batchSize, organizationId)
      sent += batch.sent

      if (batch.state === 'done') {
        const completion = await completeBroadcastStep(broadcastId, organizationId)

        return {
          status: completion.status,
          sent: completion.sent,
          recipients: completion.recipients
        }
      }

      if (batch.state === 'cancelled') return { status: 'cancelled' as const, sent }

      if (batch.state === 'limited') await sleep(LIMITED_BACKOFF)

      if (batch.state === 'throttled') await sleep(THROTTLED_BACKOFF)

      if (batch.state === 'paused') {
        const state = await waitForResume(broadcastId, organizationId)

        if (state === 'cancelled') return { status: 'cancelled' as const, sent }
      }
    }

    const nextRunId = await continueBroadcastStep(broadcastId, organizationId)

    return { status: 'continued' as const, sent, nextRunId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failBroadcastStep(
      broadcastId,
      FatalError.is(error) ? message : `Sending stopped after repeated errors: ${message}`,
      organizationId
    )

    return { status: 'failed' as const, error: message }
  }
}

/**
 * Parks the run until the broadcast is resumed. The hook is registered before the
 * status is re-checked, so a resume that lands in between is never missed.
 */
async function waitForResume(
  broadcastId: string,
  organizationId: string | undefined
): Promise<'resumed' | 'cancelled'> {
  const hook = createHook<{ resumedAt?: string }>({ token: `broadcast:${broadcastId}:resume` })

  try {
    const conflict = await hook.getConflict()
    const status = await broadcastStatusStep(broadcastId, organizationId)

    if (status === 'sending') return 'resumed'

    if (status !== 'paused') return 'cancelled'

    if (conflict) {
      // Another run owns the token (should not happen): fall back to polling.
      while ((await broadcastStatusStep(broadcastId, organizationId)) === 'paused')
        await sleep('1m')

      return 'resumed'
    }

    await hook

    return 'resumed'
  } finally {
    hook.dispose()
  }
}
