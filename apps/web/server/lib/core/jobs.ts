import type { JsonObject } from '../../../shared/types/domain'

/** Payload delivered to a paused workflow hook (stored by the Workflow SDK as JSON). */
export type HookPayload = JsonObject

/**
 * Abstraction over durable background execution (Workflow SDK in the app,
 * an in-memory recorder in tests). Services depend on this interface only,
 * which keeps them free of `workflow/api` imports and circular dependencies.
 * Every job runs inside one organization, passed first.
 */
export interface JobLauncher {
  sendBroadcast(organizationId: string, broadcastId: string): Promise<string>
  sendTransactional(organizationId: string, messageId: string): Promise<string>
  runImport(organizationId: string, importId: string): Promise<string>
  doubleOptIn(organizationId: string, contactId: string, listId: string): Promise<string>
  drainWebhookEndpoint(organizationId: string, endpointId: string, owner: string): Promise<string>
  syncSegments(organizationId: string, segmentId?: string): Promise<string>
  /** Resume a paused workflow hook. Returns false when the hook no longer exists. */
  resumeHook(token: string, payload: HookPayload): Promise<boolean>
  cancel(runId: string): Promise<void>
}

export interface LaunchedJob {
  job: keyof JobLauncher
  args: (string | HookPayload)[]
}

/** Records launched jobs without executing them (tests, scripts). */
export class RecordingJobLauncher implements JobLauncher {
  readonly launched: LaunchedJob[] = []

  private record(job: keyof JobLauncher, ...args: (string | HookPayload)[]) {
    this.launched.push({ job, args })

    return Promise.resolve(`run_${this.launched.length}`)
  }

  sendBroadcast(organizationId: string, broadcastId: string) {
    return this.record('sendBroadcast', organizationId, broadcastId)
  }
  sendTransactional(organizationId: string, messageId: string) {
    return this.record('sendTransactional', organizationId, messageId)
  }
  runImport(organizationId: string, importId: string) {
    return this.record('runImport', organizationId, importId)
  }
  doubleOptIn(organizationId: string, contactId: string, listId: string) {
    return this.record('doubleOptIn', organizationId, contactId, listId)
  }
  drainWebhookEndpoint(organizationId: string, endpointId: string, owner: string) {
    return this.record('drainWebhookEndpoint', organizationId, endpointId, owner)
  }
  syncSegments(organizationId: string, segmentId?: string) {
    if (segmentId) return this.record('syncSegments', organizationId, segmentId)

    return this.record('syncSegments', organizationId)
  }
  async resumeHook(token: string, payload: HookPayload) {
    await this.record('resumeHook', token, payload)

    return true
  }

  async cancel(runId: string) {
    await this.record('cancel', runId)
  }
}
