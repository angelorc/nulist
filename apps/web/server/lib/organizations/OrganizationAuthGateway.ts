import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError
} from '../core/errors'
import { callAuth, organizationApi } from '../settings/auth/BetterAuthApi'
import type {
  AuthApiObject,
  AuthInvitationRecord,
  AuthMemberRecord,
  AuthOrganizationRecord,
  BetterAuthOrganizationApi
} from '../settings/auth/BetterAuthApi'

/** Organization fields that can be changed through Better Auth. */
export interface OrganizationChanges {
  name?: string
  slug?: string
  logo?: string | null
}

/** Better Auth error codes (lowercased by `callAuth`) and the domain error they become. */
const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'user_is_already_a_member_of_this_organization',
  'user_is_already_invited_to_this_organization',
  'organization_already_exists',
  'organization_slug_already_taken'
])

const INVALID_STATE_CODES: ReadonlySet<string> = new Set([
  'you_cannot_leave_the_organization_as_the_only_owner',
  'you_cannot_leave_the_organization_without_an_owner',
  'organization_membership_limit_reached',
  'invitation_limit_reached'
])

const NOT_FOUND_CODES: ReadonlyMap<string, string> = new Map([
  ['invitation_not_found', 'Invitation'],
  ['member_not_found', 'Member'],
  ['organization_not_found', 'Organization']
])

/** Gives Better Auth refusals the status the dashboard expects (409, 404, 403). */
function remap(error: DomainError): DomainError {
  const entity = NOT_FOUND_CODES.get(error.code)

  if (entity) return new NotFoundError(entity)

  if (CONFLICT_CODES.has(error.code)) return new ConflictError(error.message, error.code)

  if (INVALID_STATE_CODES.has(error.code)) return new InvalidStateError(error.message)

  if (error.status === 403) return new ForbiddenError(error.message, error.code)

  return error
}

/**
 * Better Auth organization endpoints called on behalf of the signed-in user of
 * one request (its headers are forwarded, so Better Auth applies its own
 * permission, owner and membership rules). Errors become DomainErrors.
 * Built per request with `OrganizationAuthGateway.from(serverAuth(event).api, event.headers)`.
 */
export class OrganizationAuthGateway {
  constructor(
    private readonly api: BetterAuthOrganizationApi,
    private readonly headers: Headers
  ) {}

  static from(api: AuthApiObject, headers: Headers): OrganizationAuthGateway {
    return new OrganizationAuthGateway(organizationApi(api), headers)
  }

  // Members --------------------------------------------------------------------

  updateMemberRole(
    organizationId: string,
    memberId: string,
    role: string
  ): Promise<AuthMemberRecord> {
    return this.call(() =>
      this.api.updateMemberRole({
        headers: this.headers,
        body: { memberId, role, organizationId }
      })
    )
  }

  async removeMember(organizationId: string, memberId: string): Promise<void> {
    await this.call(() =>
      this.api.removeMember({
        headers: this.headers,
        body: { memberIdOrEmail: memberId, organizationId }
      })
    )
  }

  /** The signed-in user leaves the organization (Better Auth refuses the only owner). */
  async leave(organizationId: string): Promise<void> {
    await this.call(() =>
      this.api.leaveOrganization({ headers: this.headers, body: { organizationId } })
    )
  }

  // Invitations ----------------------------------------------------------------

  /** Invites `email` (lowercase); `resend` renews and re-sends a pending invitation instead. */
  invite(
    organizationId: string,
    email: string,
    role: string,
    resend = false
  ): Promise<AuthInvitationRecord> {
    return this.call(() =>
      this.api.createInvitation({
        headers: this.headers,
        body: { email, role, organizationId, resend }
      })
    )
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    await this.call(() =>
      this.api.cancelInvitation({ headers: this.headers, body: { invitationId } })
    )
  }

  /** Accepts as the signed-in user (must be the invited email); returns the new membership. */
  async acceptInvitation(invitationId: string): Promise<AuthMemberRecord> {
    const result = await this.call(() =>
      this.api.acceptInvitation({ headers: this.headers, body: { invitationId } })
    )

    if (!result) throw new NotFoundError('Invitation', invitationId)

    return result.member
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    await this.call(() =>
      this.api.rejectInvitation({ headers: this.headers, body: { invitationId } })
    )
  }

  // Organizations --------------------------------------------------------------

  async updateOrganization(
    organizationId: string,
    data: OrganizationChanges
  ): Promise<AuthOrganizationRecord> {
    const updated = await this.call(() =>
      this.api.updateOrganization({ headers: this.headers, body: { organizationId, data } })
    )

    if (!updated) throw new NotFoundError('Organization', organizationId)

    return updated
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    await this.call(() =>
      this.api.deleteOrganization({ headers: this.headers, body: { organizationId } })
    )
  }

  /**
   * System action (no session): creates an organization owned by `ownerUserId`.
   * Better Auth skips `allowUserToCreateOrganization`, so callers authorize first.
   */
  async createOrganizationFor(
    ownerUserId: string,
    name: string,
    slug: string
  ): Promise<AuthOrganizationRecord> {
    const created = await this.call(() =>
      this.api.createOrganization({ body: { name, slug, userId: ownerUserId } })
    )

    if (!created)
      throw new DomainError('The organization could not be created.', 500, 'create_failed')

    return created
  }

  /**
   * Makes `organizationId` (or none) active on the signed-in session and returns
   * the Set-Cookie values to forward: the session cookie cache carries it.
   */
  async setActive(organizationId: string | null): Promise<string[]> {
    const { headers } = await this.call(() =>
      this.api.setActiveOrganization({
        headers: this.headers,
        body: { organizationId },
        returnHeaders: true
      })
    )

    return headers.getSetCookie()
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await callAuth(run)
    } catch (cause) {
      if (cause instanceof DomainError) throw remap(cause)
      throw cause
    }
  }
}
