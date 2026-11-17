import type { Timestamp } from './contacts'

export type SegmentMembershipChangeKind = 'entered' | 'exited'

export interface SegmentMembershipStats {
  members: number | null
  enteredRecently: number
  exitedRecently: number
  syncedAt: Timestamp | null
}

export interface SegmentMembershipContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export interface SegmentMembershipChange {
  id: string
  change: SegmentMembershipChangeKind
  at: Timestamp
  contact: SegmentMembershipContact | null
}

export interface ContactSegmentEntry {
  segmentId: string
  enteredAt: Timestamp
}
