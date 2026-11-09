export interface StoredObject {
  key: string
  url: string
}

/** Strategy interface for object storage (S3 compatible in production). */
export interface StorageProvider {
  readonly id: string
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>
  delete(key: string): Promise<void>
  /** Deletes the given objects in batches; returns how many were requested for removal. */
  deleteMany(keys: readonly string[], signal?: AbortSignal): Promise<number>
  /** Deletes every object whose key starts with `prefix` (never empty); returns how many. */
  deletePrefix(prefix: string, signal?: AbortSignal): Promise<number>
  publicUrl(key: string): string
  /** Throws when the configuration is unusable; creates the bucket if missing. */
  verify(): Promise<void>
  /** Releases connections when the provider is replaced. */
  close?(): void
}
