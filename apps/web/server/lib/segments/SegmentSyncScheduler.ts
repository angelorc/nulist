import { isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { segments } from '../../db/schema'
import type { JobLauncher } from '../core/jobs'
import { PERIODIC_SYNC_MIN_AGE_SECONDS } from './SegmentMembershipService'

export interface SegmentSyncRun {
  skipped: boolean
  organizations: number
}

type LockRow = {
  locked: boolean
}

const LOCK_KEY = 'segment-membership-scheduler'

export class SegmentSyncScheduler {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobLauncher
  ) {}

  async run(): Promise<SegmentSyncRun> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<LockRow>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) as locked`
      )

      if (!lock.rows[0]?.locked) return { skipped: true, organizations: 0 }

      const rows = await tx
        .selectDistinct({ organizationId: segments.organizationId })
        .from(segments)
        .where(
          or(
            isNull(segments.membershipSyncedAt),
            lt(
              segments.membershipSyncedAt,
              sql`now() - make_interval(secs => ${PERIODIC_SYNC_MIN_AGE_SECONDS})`
            )
          )
        )

      await Promise.all(rows.map((row) => this.jobs.syncSegments(row.organizationId)))

      return { skipped: false, organizations: rows.length }
    })
  }
}
