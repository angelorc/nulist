import type { BroadcastStatus } from '../types/domain'

/** Ended states in which a broadcast can be deleted, provided sending never started. */
export const UNSENT_ENDED_BROADCAST_STATUSES: readonly BroadcastStatus[] = ['cancelled', 'failed']

/** What the deletion rule reads from a broadcast (a row or its wire shape). */
export interface DeletableBroadcast {
  status: BroadcastStatus
  startedAt: Date | string | null
}

/**
 * Whether a broadcast can be deleted (dashboard and REST API alike): a draft, or
 * one cancelled (or failed) before sending started. Deleting a broadcast deletes
 * its messages, so one that sent anything keeps its delivery history and its
 * weight in the send limits.
 */
export function isBroadcastDeletable(broadcast: DeletableBroadcast): boolean {
  return (
    broadcast.status === 'draft' ||
    (UNSENT_ENDED_BROADCAST_STATUSES.includes(broadcast.status) && !broadcast.startedAt)
  )
}
