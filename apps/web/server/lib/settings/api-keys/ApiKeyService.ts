import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../../db/client'
import { apikey, user } from '../../../db/schema'
import { API_KEY_SCOPES } from '../../../../shared/auth/permissions'
import type {
  ApiKeyCreateInput,
  ApiKeyCreator,
  ApiKeySummary,
  CreatedApiKey
} from '../../../../shared/schemas/api-keys'
import type { AuditLogger } from '../../audit/AuditLogger'
import type { Actor } from '../../core/actor'
import { NotFoundError } from '../../core/errors'
import type { TenantScope } from '../../core/TenantScope'
import type { ApiKeyIssuer } from './ApiKeyIssuer'
import { parseKeyMetadata, parseKeyPermissions, scopeOf } from './keyMetadata'

export { parseKeyMetadata, scopeOf } from './keyMetadata'

export type { ApiKeyMetadata } from './keyMetadata'

const DAY_SECONDS = 86_400

/** Columns read for a key listing (never the hash). */
interface KeyRow {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  enabled: boolean | null
  metadata: string | null
  permissions: string | null
  requestCount: number | null
  lastRequest: Date | null
  expiresAt: Date | null
  createdAt: Date
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null)

/**
 * API keys of one organization for the public REST API (/api/v1). Keys are
 * issued by Better Auth with the organization as their reference, listed from
 * the apikey table filtered to the organization, and keep working when their
 * creator leaves. Another organization's key ids behave as not found.
 */
export class ApiKeyService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly audit: AuditLogger,
    private readonly issuer: ApiKeyIssuer
  ) {}

  private selectKeys() {
    return this.db
      .select({
        id: apikey.id,
        name: apikey.name,
        start: apikey.start,
        prefix: apikey.prefix,
        enabled: apikey.enabled,
        metadata: apikey.metadata,
        permissions: apikey.permissions,
        requestCount: apikey.requestCount,
        lastRequest: apikey.lastRequest,
        expiresAt: apikey.expiresAt,
        createdAt: apikey.createdAt
      })
      .from(apikey)
  }

  /** The members who created `rows`, by user id (deleted users are absent). */
  private async creators(rows: readonly KeyRow[]): Promise<Map<string, ApiKeyCreator>> {
    const ids = [...new Set(rows.flatMap((row) => parseKeyMetadata(row.metadata).createdBy ?? []))]

    if (!ids.length) return new Map()

    const users = await this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, ids))

    return new Map(users.map((creator) => [creator.id, creator]))
  }

  private toSummary(row: KeyRow, creators: ReadonlyMap<string, ApiKeyCreator>): ApiKeySummary {
    const metadata = parseKeyMetadata(row.metadata)

    return {
      id: row.id,
      name: row.name,
      start: row.start,
      prefix: row.prefix,
      enabled: row.enabled ?? true,
      scope: scopeOf(metadata, parseKeyPermissions(row.permissions)),
      requestCount: row.requestCount ?? 0,
      lastRequest: iso(row.lastRequest),
      expiresAt: iso(row.expiresAt),
      createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
      createdBy: metadata.createdBy ? (creators.get(metadata.createdBy) ?? null) : null
    }
  }

  private async summarize(rows: readonly KeyRow[]): Promise<ApiKeySummary[]> {
    const creators = await this.creators(rows)

    return rows.map((row) => this.toSummary(row, creators))
  }

  /** Every key of the organization, newest first. */
  async list(): Promise<ApiKeySummary[]> {
    const rows = await this.selectKeys()
      .where(this.scope.eq(apikey.referenceId))
      .orderBy(desc(apikey.createdAt))

    return this.summarize(rows)
  }

  async get(id: string): Promise<ApiKeySummary> {
    const [row] = await this.selectKeys().where(
      and(eq(apikey.id, id), this.scope.eq(apikey.referenceId))
    )

    if (!row) throw new NotFoundError('API key', id)
    const [summary] = await this.summarize([row])

    if (!summary) throw new NotFoundError('API key', id)

    return summary
  }

  /**
   * Issues a key owned by the organization with the permissions of `input.scope`.
   * `userId` is the creating member (Better Auth re-checks `apiKey:create`).
   * The plain key is returned once and never stored.
   */
  async create(input: ApiKeyCreateInput, userId: string, actor: Actor): Promise<CreatedApiKey> {
    const days = input.expiresInDays ?? 0

    const issued = await this.issuer.issue({
      name: input.name,
      organizationId: this.scope.organizationId,
      userId,
      permissions: API_KEY_SCOPES[input.scope],
      metadata: { scope: input.scope, createdBy: userId },
      expiresIn: days > 0 ? days * DAY_SECONDS : null
    })

    const summary = await this.get(issued.id)
    await this.audit.log(actor, {
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: issued.id,
      summary: `Created API key "${input.name}" (${input.scope === 'full' ? 'full access' : 'sending only'})`,
      changes: {
        name: input.name,
        scope: input.scope,
        start: summary.start,
        expiresAt: summary.expiresAt
      }
    })

    return { ...summary, key: issued.key }
  }

  /**
   * Revokes (deletes) a key of the organization through Better Auth, on behalf
   * of the member whose request `headers` are given.
   */
  async revoke(id: string, actor: Actor, headers: Headers): Promise<void> {
    const [row] = await this.db
      .select({ id: apikey.id, name: apikey.name, start: apikey.start })
      .from(apikey)
      .where(and(eq(apikey.id, id), this.scope.eq(apikey.referenceId)))

    if (!row) throw new NotFoundError('API key', id)

    await this.issuer.revoke(id, headers)

    await this.audit.log(actor, {
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      summary: `Revoked API key "${row.name ?? row.start ?? id}"`,
      changes: { name: row.name, start: row.start }
    })
  }
}
