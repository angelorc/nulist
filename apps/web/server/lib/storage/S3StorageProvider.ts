import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from '@aws-sdk/client-s3'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import type { LookupFunction } from 'node:net'
import type { StorageSettings } from '../../../shared/types/domain'
import { DomainError, ProviderError } from '../core/errors'
import type { StorageProvider, StoredObject } from './StorageProvider'

/** DeleteObjects (and a ListObjectsV2 page) handles at most 1000 keys per request. */
const MAX_KEYS_PER_REQUEST = 1000

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'Unknown error'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error'
}

/** SVGs can carry script: opened directly they download instead of rendering on the bucket origin. */
const SVG = 'image/svg+xml'

/**
 * Any S3-compatible object store (AWS S3, R2, RustFS, MinIO, Garage…).
 * `lookup` resolves the endpoint for every connection (the outbound policy's
 * check, so a custom endpoint never reaches the instance's internal network).
 */
export class S3StorageProvider implements StorageProvider {
  readonly id = 's3'
  private readonly client: S3Client | null
  private bucketReady = false

  constructor(
    private readonly config: StorageSettings,
    lookup?: LookupFunction
  ) {
    this.client = config.bucket
      ? new S3Client({
          region: config.region || 'us-east-1',
          endpoint: config.endpoint || undefined,
          forcePathStyle: config.forcePathStyle,
          credentials: config.accessKeyId
            ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
            : undefined,
          requestHandler: lookup
            ? {
                httpAgent: new HttpAgent({ keepAlive: true, lookup }),
                httpsAgent: new HttpsAgent({ keepAlive: true, lookup })
              }
            : undefined
        })
      : null
  }

  private get s3(): S3Client {
    if (!this.client)
      throw new DomainError(
        'File storage is not configured. Set it up in Settings → Storage.',
        400,
        'storage_not_configured'
      )

    return this.client
  }

  publicUrl(key: string): string {
    const base =
      this.config.publicUrl ||
      (this.config.endpoint
        ? `${this.config.endpoint.replace(/\/+$/, '')}/${this.config.bucket}`
        : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`)

    return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  async verify(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.config.bucket }))
    } catch (cause) {
      if (cause instanceof DomainError) throw cause

      const status =
        cause instanceof S3ServiceException ? cause.$metadata.httpStatusCode : undefined

      if (status !== 404)
        throw new ProviderError(`Storage check failed: ${errorName(cause)}`, false)
      await this.createPublicBucket()
    }

    this.bucketReady = true
  }

  /** Creates the bucket with an anonymous read policy so images load inside emails. */
  private async createPublicBucket() {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.config.bucket }))
      await this.s3.send(
        new PutBucketPolicyCommand({
          Bucket: this.config.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.config.bucket}/*`]
              }
            ]
          })
        })
      )
    } catch (cause) {
      if (cause instanceof DomainError) throw cause
      throw new ProviderError(`Could not create bucket: ${errorMessage(cause)}`, false)
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    if (!this.bucketReady) await this.verify()

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentDisposition: contentType === SVG ? 'attachment' : undefined,
          CacheControl: 'public, max-age=31536000, immutable'
        })
      )
    } catch (cause) {
      if (cause instanceof DomainError) throw cause
      throw new ProviderError(`Upload failed: ${errorMessage(cause)}`, true)
    }

    return { key, url: this.publicUrl(key) }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }

  async deleteMany(keys: readonly string[], signal?: AbortSignal): Promise<number> {
    const batches: string[][] = []

    for (let start = 0; start < keys.length; start += MAX_KEYS_PER_REQUEST)
      batches.push(keys.slice(start, start + MAX_KEYS_PER_REQUEST))

    const results = await Promise.all(
      batches.map((batch) =>
        this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true }
          }),
          { abortSignal: signal }
        )
      )
    )

    const [first, ...others] = results.flatMap((result) => result.Errors ?? [])

    if (first) {
      throw new ProviderError(
        `Could not delete ${others.length + 1} object(s): ${first.Key ?? 'unknown key'} (${first.Code ?? first.Message ?? 'error'})`,
        true
      )
    }

    return keys.length
  }

  async deletePrefix(prefix: string, signal?: AbortSignal): Promise<number> {
    if (!prefix) throw new DomainError('Refusing to delete a whole bucket.', 400, 'invalid_prefix')
    let removed = 0
    let token: string | undefined

    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: MAX_KEYS_PER_REQUEST
        }),
        { abortSignal: signal }
      )

      const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []))
      removed += await this.deleteMany(keys, signal)
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)

    return removed
  }

  /** Releases the HTTP agent (called when the organization's providers are rebuilt or evicted). */
  close(): void {
    this.client?.destroy()
  }
}
