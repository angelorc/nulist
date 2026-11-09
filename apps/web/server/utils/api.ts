import type { H3Event } from 'h3'
import { z, ZodError } from 'zod'
import { can as roleCan } from '../../shared/auth/permissions'
import type { PermissionRequest } from '../../shared/auth/permissions'
import { ACTIVE_ORGANIZATION_HEADER } from '../../shared/schemas/organization'
import type { OrganizationMembership } from '../../shared/types/domain'
import type { Actor } from '../lib/core/actor'
import type { Container } from '../lib/core/Container'
import {
  DomainError,
  ForbiddenError,
  NoActiveOrganizationError,
  NotAMemberError,
  OrganizationChangedError,
  PermissionDeniedError,
  SessionRevokedError
} from '../lib/core/errors'
import type { OrganizationContainer } from '../lib/core/OrganizationContainer'
import type { PublicContextResolver } from '../lib/organizations/PublicContextResolver'

export interface SessionUser {
  id: string
  email: string
  name: string
  /** Instance role (`admin` = instance administrator). */
  role: string | null
}

/** The organization a dashboard request works in, with the member's role there. */
export interface RequestOrganization extends OrganizationMembership {}

/** Context of a signed-in request without an organization (organization switcher, invitations). */
export interface SessionContext {
  platform: Container
  user: SessionUser
  /** Better Auth session id (the active organization is stored on the session row). */
  sessionId: string
  isInstanceAdmin: boolean
  actor: Actor
}

/** Context of a dashboard request: everything is scoped to the active organization. */
export interface ApiContext extends SessionContext {
  /** Tenant services of the active organization. */
  services: OrganizationContainer
  organization: RequestOrganization
  /** Whether the member's role allows `request` in the active organization. */
  can(request: PermissionRequest): boolean
}

/** Context of an instance administrator request (admin area). */
export interface InstanceAdminContext extends SessionContext {
  /** The platform container (same as `platform`). */
  services: Container
}

export interface PublicContext {
  /** The platform container: tenant services via `platform.forOrganization(id)`. */
  platform: Container
  /** Finds the organization behind a token, a list or a message. */
  resolver: PublicContextResolver
  actor: Actor
}

export interface ApiHandlerOptions {
  /** What the member's role must allow (every dashboard route declares one). */
  permission: PermissionRequest
}

const instanceRoleSchema = z.object({ role: z.string().nullish() })

function describeIssue(issue: ZodError['issues'][number]): string {
  const path = issue.path.map(String).join('.')

  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * h3's readValidatedBody / getValidatedQuery / getValidatedRouterParams wrap a
 * thrown ZodError in a generic 400 "Validation Error" whose `data` is the ZodError.
 */
function unwrapZodError(cause: unknown): ZodError | null {
  if (cause instanceof ZodError) return cause

  if (isError(cause) && cause.data instanceof ZodError) return cause.data

  return null
}

/** Maps domain/validation errors to client-safe HTTP errors. */
export function toHttpError(cause: unknown) {
  const zodError = unwrapZodError(cause)

  if (zodError) {
    const first = zodError.issues[0]

    return createError({
      statusCode: 422,
      statusMessage: 'validation_error',
      message: first ? describeIssue(first) : 'Invalid input',
      data: {
        code: 'validation_error',
        message: first ? describeIssue(first) : 'Invalid input',
        issues: zodError.issues
      }
    })
  }

  if (cause instanceof DomainError) {
    return createError({
      statusCode: cause.status,
      statusMessage: cause.code,
      message: cause.message,
      data: { code: cause.code, message: cause.message, ...cause.data }
    })
  }

  return cause
}

export function requestActor(
  event: H3Event,
  base: Pick<Actor, 'type' | 'id' | 'label'>,
  organizationId: string | null = null
): Actor {
  return {
    ...base,
    organizationId,
    // Resolved by server/middleware/client-address.ts (X-Forwarded-For only from trusted proxies).
    ip: getRequestIP(event) ?? null,
    userAgent: getRequestHeader(event, 'user-agent') ?? null
  }
}

/**
 * Resolves the Better Auth session of a dashboard request (401 when signed out).
 * The cookie cache outlives revoked sessions for a few minutes, so the session
 * row is re-checked unless `verify` is false (the caller checks it itself).
 */
async function sessionContext(event: H3Event, verify = true): Promise<SessionContext> {
  const { user, session } = await requireUserSession(event)
  const parsedRole = instanceRoleSchema.safeParse(user)
  const role = parsedRole.success ? (parsedRole.data.role ?? null) : null
  const platform = useServices()

  if (verify && !(await platform.organizations.isSessionActive(session.id, user.id)))
    throw new SessionRevokedError()

  return {
    platform,
    user: { id: user.id, email: user.email, name: user.name, role },
    sessionId: session.id,
    isInstanceAdmin: role === 'admin',
    actor: requestActor(event, { type: 'user', id: user.id, label: user.email })
  }
}

/**
 * The active organization of the session, re-checked against `member` on every
 * request (the session cookie cache can be stale): 409 `no_active_organization`
 * when the user belongs to none, 403 `not_a_member` after removal, and 409
 * `organization_changed` when the tab works in another organization than the
 * session (ACTIVE_ORGANIZATION_HEADER, sent by the dashboard client).
 */
async function organizationContext(event: H3Event): Promise<ApiContext> {
  // activeMembership reads the session row: it reports a revoked session itself.
  const session = await sessionContext(event, false)

  const active = await session.platform.organizations.activeMembership(
    session.sessionId,
    session.user.id
  )

  if (active.status === 'no_session') throw new SessionRevokedError()

  if (active.status === 'none') throw new NoActiveOrganizationError()

  if (active.status === 'not_member') throw new NotAMemberError()

  const organization = active.membership
  const expected = getRequestHeader(event, ACTIVE_ORGANIZATION_HEADER)

  if (expected && expected !== organization.id) throw new OrganizationChangedError(organization.id)

  return {
    ...session,
    actor: { ...session.actor, organizationId: organization.id },
    services: session.platform.forOrganization(organization.id),
    organization,
    can: (request) => roleCan(organization.role, request)
  }
}

/**
 * Authenticated dashboard endpoint scoped to the active organization. Checks
 * the session, the membership and `options.permission` (403 `forbidden` with
 * `data.required`), builds the audit actor and maps domain errors.
 */
export function defineApiHandler<T>(
  handler: (event: H3Event, ctx: ApiContext) => T | Promise<T>,
  options: ApiHandlerOptions
) {
  return defineEventHandler(async (event) => {
    try {
      const ctx = await organizationContext(event)

      if (!ctx.can(options.permission)) throw new PermissionDeniedError(options.permission)

      return await handler(event, ctx)
    } catch (cause) {
      throw toHttpError(cause)
    }
  })
}

/** Signed-in endpoint that does not need an organization (switcher, invitations, onboarding). */
export function defineSessionHandler<T>(
  handler: (event: H3Event, ctx: SessionContext) => T | Promise<T>
) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event, await sessionContext(event))
    } catch (cause) {
      throw toHttpError(cause)
    }
  })
}

/** Instance administrator endpoint (admin area): no active organization required. */
export function defineInstanceAdminHandler<T>(
  handler: (event: H3Event, ctx: InstanceAdminContext) => T | Promise<T>
) {
  return defineEventHandler(async (event) => {
    try {
      const session = await sessionContext(event)

      if (!session.isInstanceAdmin)
        throw new ForbiddenError(
          'Only instance administrators can do this.',
          'instance_admin_required'
        )

      return await handler(event, { ...session, services: session.platform })
    } catch (cause) {
      throw toHttpError(cause)
    }
  })
}

/** Unauthenticated endpoint (public pages, provider webhooks). */
export function definePublicHandler<T>(
  handler: (event: H3Event, ctx: PublicContext) => T | Promise<T>
) {
  return defineEventHandler(async (event) => {
    const platform = useServices()

    const ctx: PublicContext = {
      platform,
      resolver: platform.publicContext,
      actor: requestActor(event, { type: 'system', id: null, label: 'Public' })
    }

    try {
      return await handler(event, ctx)
    } catch (cause) {
      throw toHttpError(cause)
    }
  })
}
