import { createHook, sleep } from 'workflow'
import {
  continueWebhookDrainStep,
  drainWebhookBatchStep,
  releaseWebhookDrainStep
} from './steps/webhooks'

const MAX_ITERATIONS_PER_RUN = 3000

export async function drainWebhookEndpointWorkflow(
  endpointId: string,
  organizationId: string,
  owner: string
) {
  'use workflow'

  using wake = createHook<{ wokenAt?: string }>({ token: `webhook-drain:${owner}` })
  let processed = 0

  for (let iteration = 0; iteration < MAX_ITERATIONS_PER_RUN; iteration++) {
    const batch = await drainWebhookBatchStep(endpointId, organizationId, owner)

    if (!batch.owned) return { status: 'superseded' as const, processed }
    processed += batch.processed

    if (batch.processed > 0) continue

    if (batch.nextDueAt && !batch.disabled) {
      await Promise.race([wake, sleep(new Date(batch.nextDueAt))])
      continue
    }

    if (!(await releaseWebhookDrainStep(endpointId, organizationId, owner)))
      return { status: 'idle' as const, processed }
  }

  const nextRunId = await continueWebhookDrainStep(endpointId, organizationId, owner)

  return { status: 'continued' as const, processed, nextRunId }
}
