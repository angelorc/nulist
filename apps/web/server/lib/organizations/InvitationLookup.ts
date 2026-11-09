import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { invitation, organization, user } from '../../db/schema'
import { invitationStatusSchema } from '../../../shared/schemas/members'
import type { InvitationDetails, ReceivedInvitation } from '../../../shared/schemas/members'
import { NotFoundError } from '../core/errors'
import type { OrganizationAuthGateway } from './OrganizationAuthGateway'

/** Unknown stored states read as canceled (never actionable). */
const statusSchema = invitationStatusSchema.catch('canceled')

const uuidSchema = z.uuid()

const inviter = alias(user, 'inviter')

/**
 * Invitations seen from the invitee's side, across organizations (no tenant
 * scope): the invitation page, which works signed out (the random invitation
 * id is the secret), and the pending invitations of a signed-in user.
 */
export class InvitationLookup {
  constructor(private readonly db: Database) {}

  /** What the invitation page shows; never the organization's internals. */
  async details(invitationId: string): Promise<InvitationDetails> {
    const [row] = uuidSchema.safeParse(invitationId).success
      ? await this.db
          .select({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            organizationName: organization.name,
            organizationLogo: organization.logo,
            inviterName: inviter.name
          })
          .from(invitation)
          .innerJoin(organization, eq(organization.id, invitation.organizationId))
          .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
          .where(eq(invitation.id, invitationId))
      : []

    if (!row) throw new NotFoundError('Invitation')

    return {
      id: row.id,
      organizationName: row.organizationName,
      organizationLogo: row.organizationLogo,
      inviterName: row.inviterName,
      email: row.email,
      role: row.role ?? 'member',
      status: statusSchema.parse(row.status),
      expiresAt: row.expiresAt.toISOString(),
      expired: row.expiresAt.getTime() <= Date.now(),
      accountExists: await this.accountExists(row.email)
    }
  }

  /** Pending, unexpired invitations addressed to `email`, newest first. */
  async forUser(email: string): Promise<ReceivedInvitation[]> {
    const rows = await this.db
      .select({
        id: invitation.id,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organizationName: organization.name,
        organizationLogo: organization.logo,
        inviterName: inviter.name
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
      .where(
        and(
          sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, new Date())
        )
      )
      .orderBy(desc(invitation.createdAt))

    return rows.map((row) => ({
      id: row.id,
      organizationName: row.organizationName,
      organizationLogo: row.organizationLogo,
      inviterName: row.inviterName,
      role: row.role ?? 'member',
      expiresAt: row.expiresAt.toISOString()
    }))
  }

  private async accountExists(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
      .limit(1)

    return row !== undefined
  }
}

/**
 * The invitee's answer to an invitation (signed in as the invited email; no
 * organization needed). Better Auth checks the recipient, the expiry and the
 * membership limit and writes the audit entry in the organization.
 */
export class InvitationResponder {
  constructor(private readonly gateway: OrganizationAuthGateway) {}

  /**
   * Joins the organization and makes it active. Better Auth only updates the
   * session row on accept, so the session cookie is refreshed here: returns the
   * organization id and the Set-Cookie values to forward.
   */
  async accept(invitationId: string): Promise<{ organizationId: string; cookies: string[] }> {
    const joined = await this.gateway.acceptInvitation(this.validId(invitationId))
    const cookies = await this.gateway.setActive(joined.organizationId)

    return { organizationId: joined.organizationId, cookies }
  }

  async reject(invitationId: string): Promise<void> {
    await this.gateway.rejectInvitation(this.validId(invitationId))
  }

  private validId(invitationId: string): string {
    if (!uuidSchema.safeParse(invitationId).success) throw new NotFoundError('Invitation')

    return invitationId
  }
}
