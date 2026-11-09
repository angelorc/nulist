import { FatalError } from 'workflow'
import { finalizeImportStep, processImportChunkStep, stageImportStep } from './steps/import'

const CHUNK_SIZE = 1000

/**
 * Imports a CSV upload: stage the rows, apply them chunk by chunk (each chunk
 * is its own durable, retryable step) and record the outcome.
 */
export async function importContactsWorkflow(importId: string, organizationId?: string) {
  'use workflow'

  try {
    await stageImportStep(importId, organizationId)
    let afterRow = 0

    for (;;) {
      const chunk = await processImportChunkStep(importId, afterRow, CHUNK_SIZE, organizationId)
      afterRow = chunk.lastRow

      if (chunk.done) break
    }

    return await finalizeImportStep(importId, null, organizationId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return await finalizeImportStep(
      importId,
      { message, fatal: FatalError.is(error) },
      organizationId
    )
  }
}
