import type { FileUploadResult } from '#shared/schemas/files'
import { DomainError, ValidationError } from '../../lib/core/errors'
import { RequestBodyLimit } from '../../lib/core/RequestBody'

/** Files accepted in a single multipart request. */
const MAX_FILES_PER_REQUEST = 20
const MB = 1024 * 1024

/** Multipart upload: one or more parts named `file`, checked against the organization's limits. */
export default defineApiHandler(
  async (event, { services, actor }): Promise<FileUploadResult> => {
    const { maxFileSizeMb } = await services.settings.get('limits')
    const maxRequestBytes = (maxFileSizeMb ? maxFileSizeMb * MAX_FILES_PER_REQUEST : 512) * MB + MB

    // Enforced while streaming (chunked uploads have no Content-Length), then parsed from the cache.
    await new RequestBodyLimit(maxRequestBytes).read(event)
    const parts = (await readMultipartFormData(event)) ?? []
    const uploads = parts.filter((part) => part.name === 'file' && part.filename)

    if (!uploads.length) throw new ValidationError('Attach at least one file in the "file" field.')

    if (uploads.length > MAX_FILES_PER_REQUEST)
      throw new ValidationError(`Upload at most ${MAX_FILES_PER_REQUEST} files at a time.`)

    const result: FileUploadResult = { items: [], errors: [] }

    for (const part of uploads) {
      const name = part.filename ?? 'file'

      try {
        const row = await services.files.upload(
          new Uint8Array(part.data),
          name,
          part.type ?? '',
          actor
        )

        result.items.push({ ...row, createdAt: row.createdAt.toISOString() })
      } catch (error) {
        // A single upload surfaces its own error (status + message); batches report per file.
        if (uploads.length === 1 || !(error instanceof DomainError)) throw error
        result.errors.push({ name, message: error.message })
      }
    }

    if (!result.items.length)
      throw new ValidationError(result.errors[0]?.message ?? 'No file could be uploaded.', {
        errors: result.errors
      })

    return result
  },
  { permission: { file: ['create'] } }
)
