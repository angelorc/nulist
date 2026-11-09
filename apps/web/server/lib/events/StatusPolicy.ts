import type { ContactStatus, MessageStatus, SuppressionReason } from '../../../shared/types/domain'

/**
 * Forward-only state machines for event driven updates. Provider events can
 * arrive late, duplicated or out of order, so a status may only move to a
 * strictly "further" state: delivered never becomes delayed, and bounced /
 * complained always win.
 */
export class StatusPolicy {
  private static readonly MESSAGE_RANK: Record<MessageStatus, number> = {
    queued: 0,
    scheduled: 0,
    suppressed: 0,
    cancelled: 0,
    sending: 1,
    sent: 2,
    delayed: 3,
    delivered: 4,
    failed: 4,
    rejected: 4,
    bounced: 5,
    complained: 6
  }

  private static readonly CONTACT_RANK: Record<ContactStatus, number> = {
    active: 0,
    unsubscribed: 1,
    bounced: 2,
    complained: 3,
    blocklisted: 4
  }

  /** Strength of a suppression: a weaker reason never overwrites a stronger one. */
  private static readonly SUPPRESSION_RANK: Record<SuppressionReason, number> = {
    unsubscribe: 1,
    soft_bounce: 1,
    manual: 2,
    hard_bounce: 2,
    complaint: 3
  }

  static canAdvanceMessage(from: MessageStatus, to: MessageStatus): boolean {
    return StatusPolicy.MESSAGE_RANK[to] > StatusPolicy.MESSAGE_RANK[from]
  }

  static canAdvanceContact(from: ContactStatus, to: ContactStatus): boolean {
    return StatusPolicy.CONTACT_RANK[to] > StatusPolicy.CONTACT_RANK[from]
  }

  static shouldReplaceSuppression(
    existing: SuppressionReason | null,
    next: SuppressionReason
  ): boolean {
    return (
      existing === null ||
      StatusPolicy.SUPPRESSION_RANK[next] > StatusPolicy.SUPPRESSION_RANK[existing]
    )
  }
}
