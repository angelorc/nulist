import { isAPIError } from 'better-auth/api'
import { z } from 'zod'
import { DomainError } from '../../core/errors'
import type { PermissionRequest } from '../../../../shared/auth/permissions'
import type { JsonObject } from '../../../../shared/types/domain'

/**
 * The subset of the Better Auth server API (apiKey and organization plugins)
 * used by the services. `serverAuth(event).api` is typed without
 * plugin endpoints by the Nuxt module, so it is parsed into these interfaces
 * (each endpoint must exist at runtime). Keeps server/lib free of Nuxt imports.
 */
export interface AuthApiKeyRecord {
  id: string
  key: string
  name: string | null
  start: string | null
  prefix: string | null
  enabled: boolean
  /** Organization id (the plugin is configured with `references: 'organization'`). */
  referenceId: string
  permissions?: PermissionRequest | null
  createdAt: Date
}

export interface AuthOrganizationRecord {
  id: string
  name: string
  slug: string
  logo?: string | null
  createdAt: Date
}

export interface AuthMemberRecord {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: Date
  user: { id: string; name: string; email: string; image?: string | null }
}

export interface AuthInvitationRecord {
  id: string
  organizationId: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  inviterId: string
  expiresAt: Date
  createdAt?: Date
}

/** Every call made on behalf of a signed-in user forwards the request headers. */
interface WithHeaders {
  headers: Headers
}

export interface BetterAuthApiKeyApi {
  /**
   * Server-side call (no headers): `userId` must be a member of `organizationId`
   * allowed to create keys. Permissions can only be set server-side.
   */
  createApiKey(ctx: {
    body: {
      name: string
      userId: string
      organizationId: string
      expiresIn: number | null
      permissions?: PermissionRequest
      metadata: JsonObject
    }
  }): Promise<AuthApiKeyRecord>
  /** Session-bound: the signed-in member needs `apiKey:delete` in the key's organization. */
  deleteApiKey(ctx: WithHeaders & { body: { keyId: string } }): Promise<{ success: boolean }>
}

export interface BetterAuthOrganizationApi {
  /** Returns the response headers too, so Set-Cookie (session cache) can be forwarded. */
  setActiveOrganization(
    ctx: WithHeaders & { body: { organizationId: string | null }; returnHeaders: true }
  ): Promise<{ headers: Headers; response: AuthOrganizationRecord | null }>
  /** Server-side with `userId` (instance admins creating an organization for someone). */
  createOrganization(ctx: {
    body: {
      name: string
      slug: string
      logo?: string
      userId?: string
      keepCurrentActiveOrganization?: boolean
    }
    headers?: Headers
  }): Promise<AuthOrganizationRecord | null>
  updateOrganization(
    ctx: WithHeaders & {
      body: {
        organizationId: string
        data: { name?: string; slug?: string; logo?: string | null }
      }
    }
  ): Promise<AuthOrganizationRecord | null>
  deleteOrganization(
    ctx: WithHeaders & { body: { organizationId: string } }
  ): Promise<AuthOrganizationRecord | null>
  checkOrganizationSlug(ctx: WithHeaders & { body: { slug: string } }): Promise<{
    status: boolean
  }>
  listMembers(
    ctx: WithHeaders & { query: { organizationId: string; limit?: number; offset?: number } }
  ): Promise<{ members: AuthMemberRecord[]; total: number }>
  /** Server-side only (no headers): adds an existing user directly. */
  addMember(ctx: {
    body: { userId: string; role: string; organizationId: string }
  }): Promise<AuthMemberRecord | null>
  updateMemberRole(
    ctx: WithHeaders & { body: { memberId: string; role: string; organizationId: string } }
  ): Promise<AuthMemberRecord>
  removeMember(
    ctx: WithHeaders & { body: { memberIdOrEmail: string; organizationId: string } }
  ): Promise<{ member: AuthMemberRecord } | null>
  leaveOrganization(
    ctx: WithHeaders & { body: { organizationId: string } }
  ): Promise<AuthMemberRecord | null>
  createInvitation(
    ctx: WithHeaders & {
      body: { email: string; role: string; organizationId: string; resend?: boolean }
    }
  ): Promise<AuthInvitationRecord>
  cancelInvitation(
    ctx: WithHeaders & { body: { invitationId: string } }
  ): Promise<AuthInvitationRecord | null>
  acceptInvitation(ctx: WithHeaders & { body: { invitationId: string } }): Promise<{
    invitation: AuthInvitationRecord
    member: AuthMemberRecord
  } | null>
  rejectInvitation(ctx: WithHeaders & { body: { invitationId: string } }): Promise<{
    invitation: AuthInvitationRecord | null
  }>
  getInvitation(
    ctx: WithHeaders & { query: { id: string } }
  ): Promise<AuthInvitationRecord & { organizationName: string; inviterEmail: string }>
  listInvitations(
    ctx: WithHeaders & { query: { organizationId: string } }
  ): Promise<AuthInvitationRecord[]>
}

/** A Better Auth endpoint, typed by the interface it belongs to. */
function endpoint<T>() {
  return z.custom<T>((value) => value instanceof Function)
}

const apiKeyApiSchema = z.object({
  createApiKey: endpoint<BetterAuthApiKeyApi['createApiKey']>(),
  deleteApiKey: endpoint<BetterAuthApiKeyApi['deleteApiKey']>()
}) satisfies z.ZodType<BetterAuthApiKeyApi>

type OrgEndpoint<K extends keyof BetterAuthOrganizationApi> = BetterAuthOrganizationApi[K]

const organizationApiSchema = z.object({
  setActiveOrganization: endpoint<OrgEndpoint<'setActiveOrganization'>>(),
  createOrganization: endpoint<OrgEndpoint<'createOrganization'>>(),
  updateOrganization: endpoint<OrgEndpoint<'updateOrganization'>>(),
  deleteOrganization: endpoint<OrgEndpoint<'deleteOrganization'>>(),
  checkOrganizationSlug: endpoint<OrgEndpoint<'checkOrganizationSlug'>>(),
  listMembers: endpoint<OrgEndpoint<'listMembers'>>(),
  addMember: endpoint<OrgEndpoint<'addMember'>>(),
  updateMemberRole: endpoint<OrgEndpoint<'updateMemberRole'>>(),
  removeMember: endpoint<OrgEndpoint<'removeMember'>>(),
  leaveOrganization: endpoint<OrgEndpoint<'leaveOrganization'>>(),
  createInvitation: endpoint<OrgEndpoint<'createInvitation'>>(),
  cancelInvitation: endpoint<OrgEndpoint<'cancelInvitation'>>(),
  acceptInvitation: endpoint<OrgEndpoint<'acceptInvitation'>>(),
  rejectInvitation: endpoint<OrgEndpoint<'rejectInvitation'>>(),
  getInvitation: endpoint<OrgEndpoint<'getInvitation'>>(),
  listInvitations: endpoint<OrgEndpoint<'listInvitations'>>()
}) satisfies z.ZodType<BetterAuthOrganizationApi>

/**
 * `serverAuth(event).api` (or `auth.api`). Typed by the Nuxt module without plugin
 * endpoints, so only its plugin endpoints are read, after validation.
 */
export interface AuthApiObject {
  readonly getSession: (...args: never[]) => Promise<object | null>
}

function parsePlugin<T>(schema: z.ZodType<T>, api: AuthApiObject, plugin: string): T {
  const parsed = schema.safeParse(api)

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Better Auth ${plugin} plugin is not enabled (missing ${missing})`)
  }

  return parsed.data
}

/** Narrows the Better Auth API to the apiKey plugin endpoints (verified at runtime). */
export function apiKeyApi(api: AuthApiObject): BetterAuthApiKeyApi {
  return parsePlugin(apiKeyApiSchema, api, 'apiKey')
}

/** Narrows the Better Auth API to the organization plugin endpoints (verified at runtime). */
export function organizationApi(api: AuthApiObject): BetterAuthOrganizationApi {
  return parsePlugin(organizationApiSchema, api, 'organization')
}

const FALLBACK_MESSAGES = {
  401: 'Your session has expired. Sign in again.',
  403: 'You do not have permission to perform this action',
  404: 'Not found'
} as const satisfies Partial<Record<number, string>>

function fallbackMessage(status: number): string | undefined {
  if (status === 401 || status === 403 || status === 404) return FALLBACK_MESSAGES[status]

  return undefined
}

const apiErrorSchema = z.object({
  statusCode: z.number().int().optional(),
  body: z.object({ message: z.string().optional(), code: z.string().optional() }).optional()
})

/** Organization endpoints answer 401 when a signed-in member lacks a permission. */
const PERMISSION_CODE = /^YOU_ARE_NOT_ALLOWED_TO_|^USER_IS_NOT_A_MEMBER|^YOU_CANNOT_/

/** The app's own status and code for an organization or API key refusal. */
interface AppAuthError {
  status: number
  code: string
}

/** Better Auth codes the dashboard handles like its own guards (server/utils/api.ts). */
const APP_ERRORS: ReadonlyMap<string, AppAuthError> = new Map([
  ['NO_ACTIVE_ORGANIZATION', { status: 409, code: 'no_active_organization' }],
  ['YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION', { status: 403, code: 'not_a_member' }],
  ['USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION', { status: 403, code: 'not_a_member' }],
  ['INSUFFICIENT_API_KEY_PERMISSIONS', { status: 403, code: 'forbidden' }]
])

/** Status and lowercase code of a Better Auth error code as the app reports it. */
function appError(code: string, status: number): AppAuthError {
  const known = APP_ERRORS.get(code)

  if (known) return known

  return {
    status: status === 401 && PERMISSION_CODE.test(code) ? 403 : status,
    code: code.toLowerCase()
  }
}

/**
 * Converts Better Auth APIErrors into client-safe DomainErrors (other errors pass
 * through). Permission refusals from the organization plugin become 403s, and
 * organization refusals use the app's codes (`no_active_organization`, `not_a_member`, `forbidden`).
 */
export async function callAuth<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (!isAPIError(cause)) throw cause
    const parsed = apiErrorSchema.safeParse(cause)
    const details = parsed.success ? parsed.data : {}
    const { status, code } = appError(details.body?.code ?? 'AUTH_ERROR', details.statusCode ?? 400)

    const message =
      details.body?.message ||
      cause.message ||
      fallbackMessage(status) ||
      'The request was rejected'

    throw new DomainError(message, status, code)
  }
}
