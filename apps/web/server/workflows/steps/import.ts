import { FatalError } from 'workflow'
import { DomainError } from '../../lib/core/errors'
import { useJobServices } from '../../utils/services'

/** Parses the uploaded CSV into staged rows. Bad files fail fast (no retries). */
export async function stageImportStep(
  importId: string,
  organizationId?: string
): Promise<{ totalRows: number }> {
  'use step'

  try {
    return await (await useJobServices(organizationId, 'import', importId)).imports.stage(importId)
  } catch (error) {
    if (error instanceof DomainError) throw new FatalError(error.message)
    throw error
  }
}

stageImportStep.maxRetries = 2

/** Applies one chunk of staged rows; transactional, so retries are safe. */
export async function processImportChunkStep(
  importId: string,
  afterRow: number,
  size: number,
  organizationId?: string
): Promise<{ lastRow: number; done: boolean }> {
  'use step'

  try {
    return await (
      await useJobServices(organizationId, 'import', importId)
    ).imports.processChunk(importId, afterRow, size)
  } catch (error) {
    if (error instanceof DomainError) throw new FatalError(error.message)
    throw error
  }
}

processImportChunkStep.maxRetries = 3

/** Records the final status. `failure` is null when every chunk went through. */
export async function finalizeImportStep(
  importId: string,
  failure: { message: string; fatal: boolean } | null,
  organizationId?: string
) {
  'use step'

  const services = await useJobServices(organizationId, 'import', importId)
  const summary = await services.imports.finalize(importId, failure)

  return {
    status: summary.status,
    totalRows: summary.totalRows,
    created: summary.createdCount,
    updated: summary.updatedCount,
    skipped: summary.skippedCount,
    errors: summary.errorCount
  }
}

finalizeImportStep.maxRetries = 5
