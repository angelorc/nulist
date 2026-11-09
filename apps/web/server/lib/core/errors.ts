import type { PermissionRequest } from '../../../shared/auth/permissions'
import { ORGANIZATION_CHANGED } from '../../../shared/schemas/organization'
import type { JsonObject } from '../../../shared/types/domain'

/**
 * Domain errors are thrown by services and mapped to HTTP responses by
 * `defineApiHandler` (server/utils/api.ts). They never leak internals.
 * `data` is merged into the client-facing error body, so it must be JSON.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'bad_request',
    readonly data?: JsonObject
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} not found` : `${entity} not found`, 404, 'not_found', { entity })
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, data?: JsonObject) {
    super(message, 422, 'validation_error', data)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'conflict', data?: JsonObject) {
    super(message, 409, code, data)
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    message = 'You do not have permission to perform this action',
    code = 'forbidden',
    data?: JsonObject
  ) {
    super(message, 403, code, data)
  }
}

/** The signed-in user's role in the active organization does not grant `required`. */
export class PermissionDeniedError extends ForbiddenError {
  constructor(readonly required: PermissionRequest) {
    super('You do not have permission to perform this action', 'forbidden', { required })
  }
}

/** The signed-in user is not (or no longer) a member of the organization. */
export class NotAMemberError extends ForbiddenError {
  constructor() {
    super('You are not a member of this organization.', 'not_a_member')
  }
}

/** The session was revoked or expired while its cookie cache is still valid. */
export class SessionRevokedError extends DomainError {
  constructor() {
    super('Your session has ended. Sign in again.', 401, 'session_revoked')
  }
}

/** The session has no active organization: the client must pick one first. */
export class NoActiveOrganizationError extends DomainError {
  constructor() {
    super('Select an organization first.', 409, 'no_active_organization')
  }
}

/** The tab sent a different organization than the session's active one (switched elsewhere). */
export class OrganizationChangedError extends ConflictError {
  constructor(activeOrganizationId: string) {
    super(
      'Your active organization changed in another tab. Reload the page to continue.',
      ORGANIZATION_CHANGED,
      { activeOrganizationId }
    )
  }
}

export class LimitExceededError extends DomainError {
  constructor(limit: string, used: number, max: number) {
    super(
      `Limit reached for ${limit} (${used}/${max}). Ask your instance administrator to raise it.`,
      403,
      'limit_exceeded',
      { limit, used, max }
    )
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests', 429, 'rate_limited', { retryAfter: retryAfterSeconds })
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super(message, 409, 'invalid_state')
  }
}

/** Raised by email/storage providers; `retryable` drives workflow step retries. */
export class ProviderError extends DomainError {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string
  ) {
    super(message, 502, 'provider_error', { providerCode, retryable })
  }
}
