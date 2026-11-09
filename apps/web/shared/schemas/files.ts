import { z } from 'zod'

/** Content types accepted by the file manager (validated server-side by magic bytes). */
export const ALLOWED_FILE_TYPES = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
  'application/pdf': ['pdf']
} as const satisfies Record<string, readonly string[]>

export type AllowedFileType = keyof typeof ALLOWED_FILE_TYPES

/** Value for `<input accept>`. */
export const FILE_ACCEPT = [
  ...Object.keys(ALLOWED_FILE_TYPES),
  ...Object.values(ALLOWED_FILE_TYPES)
    .flat()
    .map((ext) => `.${ext}`)
].join(',')

export const IMAGE_ACCEPT = Object.keys(ALLOWED_FILE_TYPES)
  .filter((type) => type.startsWith('image/'))
  .join(',')

export const fileTypeFilterSchema = z.enum(['image', 'other'])

export type FileTypeFilter = z.infer<typeof fileTypeFilterSchema>

export const fileListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
  q: z.string().trim().max(200).optional(),
  type: fileTypeFilterSchema.optional()
})

export type FileListQuery = z.infer<typeof fileListQuerySchema>

// ---------------------------------------------------------------------------
// Wire types (schemas parse upload responses read outside $fetch, e.g. XHR)
// ---------------------------------------------------------------------------

export const fileDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
  url: z.string(),
  createdById: z.string().nullable(),
  createdAt: z.string()
})

export type FileDto = z.infer<typeof fileDtoSchema>

export const fileUploadErrorSchema = z.object({ name: z.string(), message: z.string() })

/** A plain object type (inferred, not an interface), so it is a JSON value in error `data`. */
export type FileUploadError = z.infer<typeof fileUploadErrorSchema>

export const fileUploadResultSchema = z.object({
  items: z.array(fileDtoSchema),
  errors: z.array(fileUploadErrorSchema)
})

export type FileUploadResult = z.infer<typeof fileUploadResultSchema>

export type StorageState = 'ready' | 'not_configured' | 'unreachable'

export interface StorageStatus {
  state: StorageState
  message: string | null
  /** Per-file limit in MB (0 = unlimited). */
  maxFileSizeMb: number
  /** Total storage quota in MB (0 = unlimited). */
  maxStorageMb: number
  usedBytes: number
  fileCount: number
}

export function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/')
}
