import { NotFoundError } from '../../lib/core/errors'
import type { SegmentSyncResult } from '../../lib/segments/SegmentMembershipService'
import { useServices } from '../../utils/services'

export async function listSegmentIdsStep(organizationId: string): Promise<string[]> {
  'use step'

  return useServices().forOrganization(organizationId).segmentMemberships.segmentIds()
}

listSegmentIdsStep.maxRetries = 3

export async function listSegmentDependentsStep(
  organizationId: string,
  segmentId: string
): Promise<string[]> {
  'use step'

  return useServices().forOrganization(organizationId).segmentMemberships.dependentIds(segmentId)
}

listSegmentDependentsStep.maxRetries = 3

export async function syncSegmentStep(
  organizationId: string,
  segmentId: string,
  periodic: boolean
): Promise<SegmentSyncResult | null> {
  'use step'

  try {
    return await useServices()
      .forOrganization(organizationId)
      .segmentMemberships.sync(segmentId, { periodic })
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

syncSegmentStep.maxRetries = 3
