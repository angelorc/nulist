import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { contacts, importRows, imports, lists, suppressions } from '../../db/schema'
import type { ContactStatus, ImportRowError } from '../../../shared/types/domain'
import type { JobLauncher } from '../core/jobs'
import type { LimitService } from '../limits/LimitService'
import { ContactService } from './ContactService'
import { ImportPlan } from './ImportPlan'
import type { MappedImportRow } from './ImportPlan'
import type { TenantScope } from '../core/TenantScope'
import { SubscriptionWriter } from './SubscriptionWriter'
import type { NewSubscriptionStatus } from './SubscriptionWriter'

/** Only the first errors are kept for display; the counter keeps the full total. */
export const MAX_STORED_ERRORS = 100

export interface ImportChunkResult {
  /** Last staged row number handled by this chunk (cursor for the next one). */
  lastRow: number
  done: boolean
}

interface ContactRef {
  id: string
  email: string
  status: ContactStatus
}

interface Tally {
  created: number
  updated: number
  skipped: number
  errors: ImportRowError[]
}

/**
 * Applies one chunk of staged CSV rows with set-based SQL (one transaction):
 * validate → insert new contacts → update existing ones per mode → subscribe → bump counters.
 * Processed rows are deleted in the same transaction, so a retried step never applies a row twice.
 * Contacts, lists and suppressions are matched inside the scope's organization only.
 */
export class ImportChunkProcessor {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly limits: LimitService,
    private readonly jobs: JobLauncher
  ) {}

  private importWhere(importId: string) {
    return and(this.scope.eq(imports.organizationId), eq(imports.id, importId))
  }

  async process(importId: string, afterRow: number, size: number): Promise<ImportChunkResult> {
    const [record] = await this.db
      .select({
        status: imports.status,
        mode: imports.mode,
        listId: imports.listId,
        mapping: imports.mapping,
        subscription: imports.subscription
      })
      .from(imports)
      .where(this.importWhere(importId))

    if (!record || record.status !== 'processing') return { lastRow: afterRow, done: true }

    const rows = await this.db
      .select()
      .from(importRows)
      .where(and(eq(importRows.importId, importId), gt(importRows.rowNumber, afterRow)))
      .orderBy(asc(importRows.rowNumber))
      .limit(size)

    if (!rows.length) return { lastRow: afterRow, done: true }
    const lastRow = rows[rows.length - 1]!.rowNumber

    const plan = ImportPlan.fromStored(record)
    const overwrite = record.mode === 'overwrite'
    const tally: Tally = { created: 0, updated: 0, skipped: 0, errors: [] }

    const candidates = new Map<string, MappedImportRow>()

    for (const row of rows) {
      const mapped = plan.map(row.rowNumber, row.data, overwrite)

      if (!mapped.ok) tally.errors.push(mapped.error)
      else if (candidates.has(mapped.value.email)) tally.skipped++
      else candidates.set(mapped.value.email, mapped.value)
    }

    const [list] = record.listId
      ? await this.db
          .select({ id: lists.id, optIn: lists.optIn })
          .from(lists)
          .where(and(this.scope.eq(lists.organizationId), eq(lists.id, record.listId)))
      : []

    const subscriptionStatus: NewSubscriptionStatus =
      list?.optIn === 'double' && plan.subscription === 'send_opt_in' ? 'unconfirmed' : 'confirmed'

    const remaining = await this.limits.remainingContacts()

    const pendingOptIns = await this.db.transaction(async (tx) => {
      const existing = candidates.size
        ? await tx
            .select({ id: contacts.id, email: contacts.email, status: contacts.status })
            .from(contacts)
            .where(
              and(
                this.scope.eq(contacts.organizationId),
                inArray(contacts.email, [...candidates.keys()])
              )
            )
        : []

      const existingByEmail = new Map(existing.map((c) => [c.email, c]))
      const fresh: MappedImportRow[] = []
      const matched: MappedImportRow[] = []

      for (const candidate of candidates.values())
        (existingByEmail.has(candidate.email) ? matched : fresh).push(candidate)

      const allowed = fresh.slice(0, Math.max(0, Math.min(fresh.length, remaining)))

      for (const over of fresh.slice(allowed.length)) {
        tally.errors.push({
          row: over.row,
          email: over.email,
          message: 'Contact limit reached. Raise it in Settings → Limits.'
        })
      }

      const created = await this.insertContacts(tx, allowed)
      tally.created += created.length
      tally.skipped += allowed.length - created.length

      if (record.mode === 'skip') {
        tally.skipped += matched.length
      } else {
        await this.updateContacts(tx, matched, existingByEmail, overwrite, plan.mapsAttributes)
        tally.updated += matched.length
      }

      let pending: string[] = []

      if (list) {
        const subscribable = [...created, ...existing].flatMap((c) =>
          c.status === 'active' ? [c.id] : []
        )

        const written = await new SubscriptionWriter(this.scope, tx).addMany(
          subscribable,
          list.id,
          subscriptionStatus
        )

        if (subscriptionStatus === 'unconfirmed') pending = written.map((w) => w.contactId)
      }

      await this.recordProgress(tx, importId, rows.length, tally)
      await tx
        .delete(importRows)
        .where(and(eq(importRows.importId, importId), lte(importRows.rowNumber, lastRow)))

      return pending
    })

    if (list && pendingOptIns.length) {
      const { failed } = await SubscriptionWriter.launchOptIns(
        this.jobs,
        this.scope.organizationId,
        pendingOptIns,
        list.id
      )

      if (failed.length) {
        await this.recordProgress(this.db, importId, 0, {
          created: 0,
          updated: 0,
          skipped: 0,
          errors: failed.map((id) => ({
            row: 0,
            message: `Could not start the opt-in email for contact ${id}`
          }))
        })
      }
    }

    return { lastRow, done: rows.length < size }
  }

  /** New contacts inherit the state of an existing suppression (a re-imported bounce stays bounced). */
  private async insertContacts(tx: Executor, rows: MappedImportRow[]): Promise<ContactRef[]> {
    if (!rows.length) return []

    const blocked = await tx
      .select({ email: suppressions.email, reason: suppressions.reason })
      .from(suppressions)
      .where(
        and(
          this.scope.eq(suppressions.organizationId),
          inArray(
            suppressions.email,
            rows.map((r) => r.email)
          )
        )
      )

    const statusByEmail = new Map(
      blocked.map((b) => [b.email, ContactService.statusForSuppression(b.reason)])
    )

    return tx
      .insert(contacts)
      .values(
        this.scope.valuesMany(
          rows.map((r) => ({
            email: r.email,
            firstName: r.firstName ?? null,
            lastName: r.lastName ?? null,
            attributes: r.attributes,
            status: statusByEmail.get(r.email) ?? 'active',
            source: 'import'
          }))
        )
      )
      .onConflictDoNothing({ target: [contacts.organizationId, contacts.email] })
      .returning({ id: contacts.id, email: contacts.email, status: contacts.status })
  }

  /**
   * merge: non-empty cells update names, attributes are merged (file wins per key).
   * overwrite: mapped names are replaced (empty → cleared), attributes replaced when any are mapped.
   * The contact status is never touched, so imports never re-activate anyone.
   */
  private async updateContacts(
    tx: Executor,
    rows: MappedImportRow[],
    existing: Map<string, ContactRef>,
    overwrite: boolean,
    mapsAttributes: boolean
  ): Promise<void> {
    if (!rows.length) return

    const payload = rows.map((r) => ({
      id: existing.get(r.email)!.id,
      first_name: r.firstName ?? null,
      last_name: r.lastName ?? null,
      set_first: r.firstName !== undefined,
      set_last: r.lastName !== undefined,
      attributes: r.attributes
    }))

    const attributes =
      overwrite && mapsAttributes ? sql`v.attributes` : sql`c.attributes || v.attributes`

    await tx.execute(sql`
      update ${contacts} as c set
        first_name = case when v.set_first then v.first_name else c.first_name end,
        last_name = case when v.set_last then v.last_name else c.last_name end,
        attributes = ${attributes},
        updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        as v(id uuid, first_name text, last_name text, set_first boolean, set_last boolean, attributes jsonb)
      where c.id = v.id and ${this.scope.sql('c')}
    `)
  }

  private async recordProgress(
    tx: Executor,
    importId: string,
    processed: number,
    tally: Tally
  ): Promise<void> {
    const errors = JSON.stringify(tally.errors.slice(0, MAX_STORED_ERRORS))
    await tx
      .update(imports)
      .set({
        processedRows: sql`${imports.processedRows} + ${processed}`,
        createdCount: sql`${imports.createdCount} + ${tally.created}`,
        updatedCount: sql`${imports.updatedCount} + ${tally.updated}`,
        skippedCount: sql`${imports.skippedCount} + ${tally.skipped}`,
        errorCount: sql`${imports.errorCount} + ${tally.errors.length}`,
        errors: sql`case when jsonb_array_length(${imports.errors}) >= ${MAX_STORED_ERRORS} then ${imports.errors}
        else (select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) from (
          select a.e, a.i from jsonb_array_elements(${imports.errors} || ${errors}::jsonb) with ordinality as a(e, i)
          order by a.i limit ${MAX_STORED_ERRORS}
        ) x) end`
      })
      .where(this.importWhere(importId))
  }
}
