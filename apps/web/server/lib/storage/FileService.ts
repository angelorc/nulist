import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, ilike, not, notLike, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { files } from '../../db/schema'
import { ALLOWED_FILE_TYPES } from '../../../shared/schemas/files'
import type { AllowedFileType, FileListQuery, StorageState } from '../../../shared/schemas/files'
import type { Paginated } from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { DomainError, NotFoundError, ValidationError } from '../core/errors'
import { Page } from '../core/pagination'
import type { ProviderRegistry } from '../email/ProviderRegistry'
import type { LimitService } from '../limits/LimitService'
import { containsPattern, escapeLike } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export type FileRow = typeof files.$inferSelect

export interface DetectedType {
  contentType: AllowedFileType
  extension: string
}

export interface StorageHealth {
  state: StorageState
  message: string | null
}

export interface StorageUsage {
  usedBytes: number
  fileCount: number
}

/** Outcome of removing every stored object of an organization (before it is deleted). */
export interface StoragePurgeResult {
  state: 'purged' | 'not_configured' | 'failed'
  /** The organization's key prefix. */
  prefix: string
  objectsRemoved: number
  error: string | null
}

/** A purge never holds up an organization's deletion for longer than this. */
const PURGE_TIMEOUT_MS = 30_000

/**
 * Identifies uploads by their magic bytes (never trusting the client's
 * content type) and rejects active SVG content.
 */
export class FileTypeDetector {
  private static startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
    return signature.every((byte, i) => bytes[offset + i] === byte)
  }

  detect(bytes: Uint8Array): AllowedFileType | null {
    const has = FileTypeDetector.startsWith

    if (has(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

    if (has(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'

    if (has(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'

    if (has(bytes, [0x52, 0x49, 0x46, 0x46]) && has(bytes, [0x57, 0x45, 0x42, 0x50], 8))
      return 'image/webp'

    if (has(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'

    if (this.looksLikeSvg(bytes)) return 'image/svg+xml'

    return null
  }

  private looksLikeSvg(bytes: Uint8Array): boolean {
    const head = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, 2048))
      .replace(/^﻿/, '')
      .trimStart()

    return (
      (head.startsWith('<?xml') ||
        head.startsWith('<svg') ||
        head.startsWith('<!--') ||
        head.startsWith('<!DOCTYPE svg')) &&
      /<svg[\s>]/i.test(head)
    )
  }

  /**
   * SVGs are served from the bucket origin (as attachments), but scripts and
   * handlers are still refused. Checked on the text as the XML parser will read
   * it: character references decoded, custom entities refused, and URL schemes
   * compared without the whitespace browsers strip (`java&#9;script:`).
   */
  assertSafeSvg(bytes: Uint8Array): void {
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const text = FileTypeDetector.decodeReferences(raw)
    const compact = text.replace(/\s+/g, '')

    if (
      /<!ENTITY/i.test(raw) ||
      /<([\w.-]+:)?script[\s>/]/i.test(text) ||
      /\son[a-z]+\s*=/i.test(text) ||
      /javascript:/i.test(compact) ||
      /<([\w.-]+:)?foreignObject[\s>/]/i.test(text)
    ) {
      throw new ValidationError('SVG files with scripts or event handlers are not allowed.')
    }
  }

  /** Numeric character references and the XML predefined entities, decoded. */
  private static decodeReferences(text: string): string {
    const named = new Map([
      ['amp', '&'],
      ['lt', '<'],
      ['gt', '>'],
      ['quot', '"'],
      ['apos', "'"]
    ])

    return text.replace(
      /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));?/gi,
      (match, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
        if (name) return named.get(name.toLowerCase()) ?? match
        const code = hex ? Number.parseInt(hex, 16) : Number(decimal)

        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : ''
      }
    )
  }

  extensionFor(contentType: AllowedFileType, fileName: string): string {
    const allowed: readonly string[] = ALLOWED_FILE_TYPES[contentType]
    const fromName = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase()

    return fromName && allowed.includes(fromName) ? fromName : allowed[0]!
  }
}

/**
 * Object keys: `<prefix>/YYYY/MM/<uuid>-<safe-name>.<ext>`. Organizations get
 * `orgs/<organizationId>/uploads`, so a shared bucket is partitioned per tenant
 * and an organization's objects can be purged by prefix.
 */
export class StorageKeyBuilder {
  constructor(private readonly prefix = 'uploads') {}

  /** Every object of an organization lives under `orgs/<organizationId>/`. */
  static organizationPrefix(scope: TenantScope): string {
    return `orgs/${scope.organizationId}/`
  }

  /** Keys under `orgs/<organizationId>/uploads/`. */
  static forOrganization(scope: TenantScope): StorageKeyBuilder {
    return new StorageKeyBuilder(`${StorageKeyBuilder.organizationPrefix(scope)}uploads`)
  }

  static safeBaseName(fileName: string): string {
    const base = fileName
      .replace(/\.[^.]*$/, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '')

    return base || 'file'
  }

  build(fileName: string, extension: string, now = new Date()): string {
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')

    return `${this.prefix}/${year}/${month}/${randomUUID()}-${StorageKeyBuilder.safeBaseName(fileName)}.${extension}`
  }
}

/** C0 control characters and DEL. */
function isControlCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0

  return code < 0x20 || code === 0x7f
}

/** Display name: strip paths and control characters, keep it short. */
function displayName(fileName: string, extension: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''

  const name = Array.from(base)
    .filter((char) => !isControlCharacter(char))
    .join('')
    .trim()
    .slice(0, 200)

  return name || `file.${extension}`
}

/**
 * File manager of one organization: images and PDFs uploaded to the
 * organization's S3-compatible bucket (Settings → Storage) under its own key
 * prefix. Files of another organization behave exactly like missing ones (404).
 */
export class FileService {
  private readonly detector = new FileTypeDetector()
  private readonly keys: StorageKeyBuilder

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly providers: ProviderRegistry,
    protected readonly limits: LimitService,
    protected readonly audit: AuditLogger
  ) {
    this.keys = StorageKeyBuilder.forOrganization(scope)
  }

  /** `organization_id = <scope> AND <conditions>`: the base of every files query. */
  private scoped(...conditions: (SQL | undefined)[]): SQL | undefined {
    return and(this.scope.eq(files.organizationId), ...conditions)
  }

  async upload(
    bytes: Uint8Array,
    fileName: string,
    _contentType: string,
    actor: Actor
  ): Promise<FileRow> {
    if (!bytes.byteLength) throw new ValidationError(`"${fileName}" is empty.`)
    const contentType = this.detector.detect(bytes)

    if (!contentType) {
      throw new ValidationError(
        `"${fileName}" is not a supported file type. Upload PNG, JPG, GIF, WebP, SVG or PDF files.`
      )
    }

    if (contentType === 'image/svg+xml') this.detector.assertSafeSvg(bytes)
    await this.limits.assertUpload(bytes.byteLength)

    const extension = this.detector.extensionFor(contentType, fileName)
    const key = this.keys.build(fileName, extension)
    const storage = await this.providers.storage()
    const stored = await storage.put(key, bytes, contentType)

    let row: FileRow

    try {
      const [inserted] = await this.db
        .insert(files)
        .values(
          this.scope.values({
            key: stored.key,
            name: displayName(fileName, extension),
            contentType,
            size: bytes.byteLength,
            url: stored.url,
            createdById: actor.type === 'user' ? actor.id : null
          })
        )
        .returning()

      row = inserted!
    } catch (error) {
      await storage.delete(key).catch(() => undefined)
      throw error
    }

    await this.audit.log(actor, {
      action: 'file.uploaded',
      entityType: 'file',
      entityId: row.id,
      summary: `Uploaded "${row.name}"`,
      changes: { key: row.key, size: row.size, contentType: row.contentType }
    })

    return row
  }

  async list(query: FileListQuery): Promise<Paginated<FileRow>> {
    const page = Page.from(query)
    const q = query.q?.trim()

    const where = this.scoped(
      q ? ilike(files.name, containsPattern(q)) : undefined,
      query.type === 'image' ? ilike(files.contentType, 'image/%') : undefined,
      query.type === 'other' ? not(ilike(files.contentType, 'image/%')) : undefined
    )

    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt), desc(files.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ value: count() }).from(files).where(where)
    ])

    return page.wrap(items, total?.value ?? 0)
  }

  async findOrFail(id: string): Promise<FileRow> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(this.scoped(eq(files.id, id)))

    if (!row) throw new NotFoundError('File', id)

    return row
  }

  /**
   * Removes the object and its row (both looked up within the organization).
   * The row is removed even when the object store is unreachable, so a
   * misconfigured bucket never blocks clean-up.
   */
  async delete(id: string, actor: Actor): Promise<void> {
    const file = await this.findOrFail(id)
    let objectRemoved = true

    try {
      await (await this.providers.storage()).delete(file.key)
    } catch {
      objectRemoved = false
    }

    await this.db.delete(files).where(this.scoped(eq(files.id, id)))
    await this.audit.log(actor, {
      action: 'file.deleted',
      entityType: 'file',
      entityId: id,
      summary: `Deleted "${file.name}"`,
      changes: { key: file.key, objectRemoved }
    })
  }

  /**
   * Deletes every stored object of the organization (called before it is
   * deleted): its key prefix, plus files uploaded before keys were partitioned
   * per organization. Never throws: an unconfigured or unreachable bucket is
   * reported in the result, so it never blocks the deletion.
   */
  async purge(): Promise<StoragePurgeResult> {
    const prefix = StorageKeyBuilder.organizationPrefix(this.scope)
    const signal = AbortSignal.timeout(PURGE_TIMEOUT_MS)

    try {
      const storage = await this.providers.storage()

      const legacy = await this.db
        .select({ key: files.key })
        .from(files)
        .where(this.scoped(notLike(files.key, `${escapeLike(prefix)}%`)))

      const objectsRemoved =
        (await storage.deletePrefix(prefix, signal)) +
        (await storage.deleteMany(
          legacy.map((row) => row.key),
          signal
        ))

      return { state: 'purged', prefix, objectsRemoved, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      const notConfigured = error instanceof DomainError && error.code === 'storage_not_configured'

      return {
        state: notConfigured ? 'not_configured' : 'failed',
        prefix,
        objectsRemoved: 0,
        error: message
      }
    }
  }

  /** The organization's storage usage (what LimitService checks against `maxStorageMb`). */
  async usage(): Promise<StorageUsage> {
    const [row] = await this.db
      .select({
        bytes: sql<string>`coalesce(sum(${files.size}), 0)::bigint`,
        files: count()
      })
      .from(files)
      .where(this.scoped())

    return { usedBytes: Number(row?.bytes ?? 0), fileCount: row?.files ?? 0 }
  }

  /** Live check of the configured bucket (creates it with a public-read policy when missing). */
  async health(): Promise<StorageHealth> {
    try {
      await (await this.providers.storage()).verify()

      return { state: 'ready', message: null }
    } catch (error) {
      if (error instanceof DomainError && error.code === 'storage_not_configured')
        return { state: 'not_configured', message: error.message }
      const detail = error instanceof DomainError ? ` (${error.message})` : ''

      return {
        state: 'unreachable',
        message: `The storage bucket could not be reached${detail}. Check the endpoint and credentials in Settings → Storage.`
      }
    }
  }
}
