import type { OrganizationAuthGateway } from './OrganizationAuthGateway'
import type { OrganizationService } from './OrganizationService'

/** The organization a session switched to, and the Set-Cookie values to forward. */
export interface SessionOrganizationChange {
  organizationId: string | null
  cookies: string[]
}

/**
 * Moves the signed-in session to another organization of the user after it
 * lost its active one (left or deleted). Better Auth stores the active
 * organization on the session and in its cookie cache, so both are refreshed.
 */
export class SessionOrganization {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly gateway: OrganizationAuthGateway
  ) {}

  /** Activates the user's oldest remaining membership (none: no active organization). */
  async fallback(userId: string): Promise<SessionOrganizationChange> {
    const [next] = await this.organizations.listForUser(userId)
    const organizationId = next?.id ?? null

    return { organizationId, cookies: await this.gateway.setActive(organizationId) }
  }
}
