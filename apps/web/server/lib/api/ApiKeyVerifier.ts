import { z } from 'zod'
import { API_KEY_SCOPES } from '../../../shared/auth/permissions'
import type { GrantedPermissions } from '../../../shared/auth/permissions'
import type { ApiKeyScope, JsonObject } from '../../../shared/types/domain'
import { DomainError } from '../core/errors'
import { parseKeyMetadata } from '../settings/api-keys/ApiKeyService'
import type { AuthApiObject } from '../settings/auth/BetterAuthApi'

/** The API key behind an authenticated REST API request. */
export interface ApiKeyIdentity {
  id: string
  name: string | null
  /** First characters of the key (prefix included), safe to show. */
  start: string | null
  scope: ApiKeyScope
  /** Organization the key belongs to (Better Auth `referenceId`). */
  organizationId: string
  /** What the key may do (stored on the key; the scope preset for older keys). */
  permissions: GrantedPermissions
  /** User who created the key (metadata `createdBy`), when known. */
  createdBy: string | null
}

/** 401 for missing, unknown, disabled or expired keys. */
export class ApiAuthenticationError extends DomainError {
  constructor(message: string, code = 'invalid_api_key') {
    super(message, 401, code)
  }
}

/**
 * Strategy: turns a plain key into an identity or throws ApiAuthenticationError.
 * Permissions are authorized by the caller (`grants(identity.permissions, …)`),
 * so an insufficient key gets a 403 instead of looking like an unknown key.
 */
export interface ApiKeyVerifier {
  verify(key: string): Promise<ApiKeyIdentity>
}

// ---------------------------------------------------------------------------
// Better Auth implementation
// ---------------------------------------------------------------------------

interface VerifiedKeyRecord {
  id: string
  name: string | null
  start: string | null
  referenceId: string
  enabled: boolean
  metadata: JsonObject | string | null
  permissions?: GrantedPermissions | string | null
}

interface VerifyApiKeyResult {
  valid: boolean
  error: { message?: string | null; code?: string | null } | null
  key: VerifiedKeyRecord | null
}

/** The apiKey plugin endpoint used here (`serverAuth(event).api` satisfies it structurally). */
export interface BetterAuthVerifyApi {
  verifyApiKey(ctx: { body: { key: string } }): Promise<VerifyApiKeyResult>
}

const verifyApiSchema = z.object({
  verifyApiKey: z.custom<BetterAuthVerifyApi['verifyApiKey']>((value) => value instanceof Function)
}) satisfies z.ZodType<BetterAuthVerifyApi>

/** Narrows `serverAuth(event).api` (typed without plugin endpoints by the Nuxt module) at runtime. */
export function verifyApiKeyApi(api: AuthApiObject): BetterAuthVerifyApi {
  const parsed = verifyApiSchema.safeParse(api)

  if (!parsed.success)
    throw new Error('Better Auth apiKey plugin is not enabled (missing verifyApiKey)')

  return parsed.data
}

interface Rejection {
  code: string
  message: string
}

const REJECTIONS = new Map<string, Rejection>([
  [
    'KEY_EXPIRED',
    {
      code: 'api_key_expired',
      message: 'This API key has expired. Create a new key in Settings → API keys.'
    }
  ],
  [
    'KEY_DISABLED',
    {
      code: 'api_key_disabled',
      message: 'This API key is disabled. Create a new key in Settings → API keys.'
    }
  ]
])

const INVALID: Rejection = {
  code: 'invalid_api_key',
  message: 'The API key is invalid or was revoked. Check the Authorization header.'
}

/** What the key metadata says (`scope` preset, creator); unknown or missing values fall back. */
const keyMetadataSchema = z
  .object({
    scope: z.enum(['full', 'sending']).catch('full'),
    createdBy: z.string().nullable().catch(null)
  })
  .catch({ scope: 'full', createdBy: null })

type KeyMetadata = z.output<typeof keyMetadataSchema>

/** Metadata arrives as an object or as (possibly double-encoded) JSON text. */
function metadataOf(raw: VerifiedKeyRecord['metadata']): KeyMetadata {
  const text = z.string().safeParse(raw)

  return keyMetadataSchema.parse(text.success ? parseKeyMetadata(text.data) : (raw ?? {}))
}

const grantedSchema = z.record(z.string(), z.array(z.string()))

/** Permissions arrive parsed; JSON text (as the column stores them) is decoded too. */
const storedPermissionsSchema = z.union([
  grantedSchema,
  z.string().transform((text, ctx) => {
    try {
      return grantedSchema.parse(JSON.parse(text))
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Stored permissions are not valid JSON' })

      return z.NEVER
    }
  })
])

/**
 * What the key may do. Keys created before permissions were stored get their
 * scope preset; stored permissions that cannot be read grant nothing.
 */
function permissionsOf(record: VerifiedKeyRecord, scope: ApiKeyScope): GrantedPermissions {
  if (record.permissions === null || record.permissions === undefined) return API_KEY_SCOPES[scope]
  const parsed = storedPermissionsSchema.safeParse(record.permissions)

  return parsed.success ? parsed.data : {}
}

/**
 * Verifies keys with the Better Auth apiKey plugin (hash lookup, expiry, enabled
 * flag, usage stats). Keys are owned by an organization (`referenceId`).
 */
export class BetterAuthApiKeyVerifier implements ApiKeyVerifier {
  constructor(private readonly api: BetterAuthVerifyApi) {}

  async verify(key: string): Promise<ApiKeyIdentity> {
    let result: VerifyApiKeyResult

    try {
      result = await this.api.verifyApiKey({ body: { key } })
    } catch {
      throw new ApiAuthenticationError(INVALID.message, INVALID.code)
    }

    if (!result.valid || !result.key) {
      const rejection = REJECTIONS.get(result.error?.code ?? '') ?? INVALID
      throw new ApiAuthenticationError(rejection.message, rejection.code)
    }

    const record = result.key
    const { scope, createdBy } = metadataOf(record.metadata)

    return {
      id: record.id,
      name: record.name,
      start: record.start,
      scope,
      organizationId: record.referenceId,
      permissions: permissionsOf(record, scope),
      createdBy
    }
  }
}

/** Whether an organization still exists (`OrganizationService` satisfies it). */
export interface OrganizationExistence {
  exists(organizationId: string): Promise<boolean>
}

/**
 * Decorator: a key whose organization was deleted is invalid, even if its row
 * outlived the organization (keys reference it without a foreign key).
 */
export class OrganizationBoundApiKeyVerifier implements ApiKeyVerifier {
  constructor(
    private readonly inner: ApiKeyVerifier,
    private readonly organizations: OrganizationExistence
  ) {}

  async verify(key: string): Promise<ApiKeyIdentity> {
    const identity = await this.inner.verify(key)

    if (!(await this.organizations.exists(identity.organizationId)))
      throw new ApiAuthenticationError(INVALID.message, INVALID.code)

    return identity
  }
}
