import { and, desc, eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { importRows, imports, lists } from '../../db/schema'
import type { ImportCreateData } from '../../../shared/schemas/imports'
import type { ImportDetail, ImportSummary } from '../../../shared/types/contacts'
import type { ImportRowError } from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import { SYSTEM_ACTOR } from '../core/actor'
import type { Actor } from '../core/actor'
import { NotFoundError, ValidationError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import type { LimitService } from '../limits/LimitService'
import type { ContactService } from './ContactService'
import { CsvReader } from './CsvReader'
import { ImportChunkProcessor, MAX_STORED_ERRORS } from './ImportChunkProcessor'
import type { ImportChunkResult } from './ImportChunkProcessor'
import { ImportPlan } from './ImportPlan'
import type { TenantScope } from '../core/TenantScope'

export const IMPORT_CHUNK_SIZE = 1000
const STAGE_BATCH_SIZE = 1000

export type ImportRecord = typeof imports.$inferSelect

export interface ImportFailure {
  message: string
  /** Fatal failures carry a user-facing message; others are internal and get logged. */
  fatal: boolean
}

const UNEXPECTED_FAILURE = 'The import stopped unexpectedly. Check the server logs, then try again.'

/**
 * The organization's CSV contact imports. `create` stores the upload and starts
 * the durable workflow, which calls `stage` → `processChunk` (repeated) → `finalize`.
 * Another organization's import ids behave as not found.
 */
export class ImportService {
  private readonly processor: ImportChunkProcessor

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly contacts: ContactService,
    protected readonly limits: LimitService,
    protected readonly audit: AuditLogger,
    protected readonly jobs: JobLauncher
  ) {
    this.processor = new ImportChunkProcessor(scope, db, limits, jobs)
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  /** `imports` row condition limited to the organization. */
  private importWhere(importId: string): SQL | undefined {
    return and(this.scope.eq(imports.organizationId), eq(imports.id, importId))
  }

  private summaryQuery(where?: SQL) {
    return this.db
      .select({
        id: imports.id,
        fileName: imports.fileName,
        status: imports.status,
        mode: imports.mode,
        listId: imports.listId,
        listName: lists.name,
        totalRows: imports.totalRows,
        processedRows: imports.processedRows,
        createdCount: imports.createdCount,
        updatedCount: imports.updatedCount,
        skippedCount: imports.skippedCount,
        errorCount: imports.errorCount,
        createdAt: imports.createdAt,
        completedAt: imports.completedAt,
        mapping: imports.mapping,
        subscription: imports.subscription,
        errors: imports.errors
      })
      .from(imports)
      .leftJoin(lists, and(eq(lists.id, imports.listId), this.scope.eq(lists.organizationId)))
      .where(and(this.scope.eq(imports.organizationId), where))
  }

  async list(limit = 10): Promise<ImportSummary[]> {
    const rows = await this.summaryQuery().orderBy(desc(imports.createdAt)).limit(limit)

    return rows.map(
      ({ mapping: _mapping, subscription: _subscription, errors: _errors, ...summary }) => summary
    )
  }

  async get(id: string): Promise<ImportDetail> {
    const [row] = await this.summaryQuery(eq(imports.id, id))

    if (!row) throw new NotFoundError('Import', id)
    const { subscription, ...detail } = row

    return {
      ...detail,
      mapping: ImportPlan.fromStored(row).mapping(),
      subscriptionStatus: subscription
    }
  }

  private async record(id: string): Promise<ImportRecord> {
    const [row] = await this.db.select().from(imports).where(this.importWhere(id))

    if (!row) throw new NotFoundError('Import', id)

    return row
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  async create(input: ImportCreateData, actor: Actor): Promise<ImportDetail> {
    const plan = ImportPlan.create(input.mapping, input.subscriptionStatus)
    const headers = CsvReader.headers(input.csv)

    if (!headers.length) throw new ValidationError('The file has no header row')
    const missing = plan.missingColumns(headers)

    if (missing.length) throw new ValidationError(`Column "${missing[0]}" is not in the file`)

    const rows = CsvReader.countRows(input.csv)

    if (!rows) throw new ValidationError('The file has no data rows')
    await this.limits.assertImportRows(rows)

    const listId = input.listId ?? null

    if (listId) {
      const [list] = await this.db
        .select({ id: lists.id })
        .from(lists)
        .where(and(this.scope.eq(lists.organizationId), eq(lists.id, listId)))

      if (!list) throw new NotFoundError('List', listId)
    }

    const [created] = await this.db
      .insert(imports)
      .values(
        this.scope.values({
          fileName: input.fileName,
          status: 'pending' as const,
          listId,
          mapping: plan.mapping(),
          subscription: plan.subscription,
          mode: input.mode,
          csv: input.csv,
          totalRows: rows,
          createdById: actor.type === 'user' ? actor.id : null
        })
      )
      .returning({ id: imports.id })

    const id = created!.id

    await this.audit.log(actor, {
      action: 'import.started',
      entityType: 'import',
      entityId: id,
      summary: `Started importing ${rows} row${rows === 1 ? '' : 's'} from ${input.fileName}`,
      changes: {
        mode: input.mode,
        listId,
        subscriptionStatus: plan.subscription,
        columns: plan.mapping()
      }
    })

    try {
      const runId = await this.jobs.runImport(this.scope.organizationId, id)
      await this.db.update(imports).set({ runId }).where(this.importWhere(id))
    } catch (error) {
      console.error('[imports] failed to start the import workflow', error)
      await this.finalize(id, {
        message: 'Could not start the import job. Try again in a moment.',
        fatal: true
      })
    }

    return this.get(id)
  }

  // ---------------------------------------------------------------------------
  // Workflow steps
  // ---------------------------------------------------------------------------
  /**
   * Parses the stored CSV into `import_rows` (only mapped columns), removes
   * in-file duplicates and frees the raw upload. Idempotent.
   */
  async stage(importId: string): Promise<{ totalRows: number }> {
    const record = await this.record(importId)

    if (record.status !== 'pending') return { totalRows: record.totalRows }

    if (!record.csv) throw new ValidationError('The uploaded file is empty')

    const plan = ImportPlan.fromStored(record)
    const parsed = CsvReader.parse(record.csv)
    const missing = plan.missingColumns(parsed.headers)

    if (missing.length) throw new ValidationError(`Column "${missing[0]}" is not in the file`)

    const firstSeen = new Map<string, number>()
    const staged: (typeof importRows.$inferInsert)[] = []
    const errors: ImportRowError[] = []
    let duplicates = 0

    parsed.rows.forEach((data, index) => {
      // Spreadsheet numbering: the header is row 1.
      const row = index + 2
      const problem = parsed.malformed.get(index)

      if (problem) {
        errors.push({ row, message: `Could not read this row (${problem})` })

        return
      }

      const email = plan.normalizedEmail(data)

      if (email) {
        if (firstSeen.has(email)) {
          duplicates++

          return
        }

        firstSeen.set(email, row)
      }

      staged.push({ importId, rowNumber: row, data: plan.pick(data) })
    })

    await this.db.transaction(async (tx) => {
      await tx.delete(importRows).where(eq(importRows.importId, importId))

      for (let i = 0; i < staged.length; i += STAGE_BATCH_SIZE) {
        await tx.insert(importRows).values(staged.slice(i, i + STAGE_BATCH_SIZE))
      }

      await tx
        .update(imports)
        .set({
          status: 'processing',
          totalRows: parsed.rows.length,
          processedRows: duplicates + errors.length,
          skippedCount: duplicates,
          errorCount: errors.length,
          errors: errors.slice(0, MAX_STORED_ERRORS),
          csv: null
        })
        .where(this.importWhere(importId))
    })

    return { totalRows: parsed.rows.length }
  }

  async processChunk(
    importId: string,
    afterRow: number,
    size = IMPORT_CHUNK_SIZE
  ): Promise<ImportChunkResult> {
    return this.processor.process(importId, afterRow, size)
  }

  /** Marks the import completed (or failed), drops leftover staging rows and audits the outcome. */
  async finalize(importId: string, failure: ImportFailure | null): Promise<ImportSummary> {
    const record = await this.record(importId)

    if (record.status === 'completed' || record.status === 'failed') return this.get(importId)

    if (failure && !failure.fatal)
      console.error(`[imports] import ${importId} failed:`, failure.message)
    const message = failure ? (failure.fatal ? failure.message : UNEXPECTED_FAILURE) : null
    const status = failure ? 'failed' : 'completed'

    const outcome: Partial<ImportRecord> = { status, completedAt: new Date(), csv: null }

    if (message) {
      outcome.errors = [{ row: 0, message }, ...record.errors].slice(0, MAX_STORED_ERRORS)
      outcome.errorCount = record.errorCount + 1
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(importRows).where(eq(importRows.importId, importId))
      await tx.update(imports).set(outcome).where(this.importWhere(importId))
      await this.audit.log(
        SYSTEM_ACTOR,
        {
          action: failure ? 'import.failed' : 'import.completed',
          entityType: 'import',
          entityId: importId,
          summary: failure
            ? `Import of ${record.fileName} failed: ${message}`
            : `Imported ${record.fileName}: ${record.createdCount} created, ${record.updatedCount} updated, ${record.skippedCount} skipped, ${record.errorCount} errors`,
          changes: {
            totalRows: record.totalRows,
            created: record.createdCount,
            updated: record.updatedCount,
            skipped: record.skippedCount,
            errors: record.errorCount
          }
        },
        tx
      )
    })

    return this.get(importId)
  }
}
