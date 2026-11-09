import { getRun, resumeHook, start } from 'workflow/api'
import { HookNotFoundError } from 'workflow/errors'
import type { HookPayload, JobLauncher } from './jobs'

/**
 * JobLauncher backed by the Workflow SDK (Postgres world in self-hosted mode).
 * Workflows are imported lazily to keep the dependency graph acyclic.
 *
 * The organization id is passed as the LAST workflow argument: runs started
 * before organizations existed replay with their original arguments (no
 * organization), and the workflows resolve the organization from the entity.
 */
export class WorkflowJobLauncher implements JobLauncher {
  async sendBroadcast(organizationId: string, broadcastId: string) {
    const { sendBroadcastWorkflow } = await import('../../workflows/broadcast')

    return (await start(sendBroadcastWorkflow, [broadcastId, organizationId])).runId
  }

  async sendTransactional(organizationId: string, messageId: string) {
    const { sendTransactionalWorkflow } = await import('../../workflows/transactional')

    return (await start(sendTransactionalWorkflow, [messageId, organizationId])).runId
  }

  async runImport(organizationId: string, importId: string) {
    const { importContactsWorkflow } = await import('../../workflows/import')

    return (await start(importContactsWorkflow, [importId, organizationId])).runId
  }

  async doubleOptIn(organizationId: string, contactId: string, listId: string) {
    const { doubleOptInWorkflow } = await import('../../workflows/double-opt-in')

    return (await start(doubleOptInWorkflow, [contactId, listId, organizationId])).runId
  }

  async deliverWebhook(organizationId: string, deliveryId: string) {
    const { deliverWebhookWorkflow } = await import('../../workflows/webhook-delivery')

    return (await start(deliverWebhookWorkflow, [deliveryId, organizationId])).runId
  }

  async resumeHook(token: string, payload: HookPayload): Promise<boolean> {
    try {
      await resumeHook(token, payload)

      return true
    } catch (error) {
      if (HookNotFoundError.is(error)) return false
      throw error
    }
  }

  async cancel(runId: string): Promise<void> {
    const run = getRun(runId)

    if (await run.exists) await run.cancel()
  }
}
