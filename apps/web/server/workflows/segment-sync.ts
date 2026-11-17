import type { SegmentSyncResult } from '../lib/segments/SegmentMembershipService'
import { listSegmentDependentsStep, listSegmentIdsStep, syncSegmentStep } from './steps/segments'

export async function syncSegmentsWorkflow(organizationId: string, segmentId?: string) {
  'use workflow'

  const results: SegmentSyncResult[] = []

  if (!segmentId) {
    for (const id of await listSegmentIdsStep(organizationId)) {
      const result = await syncSegmentStep(organizationId, id, true)

      if (result) results.push(result)
    }

    return results
  }

  const synced = await syncSegmentStep(organizationId, segmentId, false)

  if (!synced) return results

  results.push(synced)

  if (synced.entered + synced.exited === 0) return results

  for (const id of await listSegmentDependentsStep(organizationId, segmentId)) {
    const result = await syncSegmentStep(organizationId, id, false)

    if (result) results.push(result)
  }

  return results
}
