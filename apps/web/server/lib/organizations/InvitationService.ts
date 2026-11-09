import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { invitation, user } from '../../db/schema'
import { roleLabel } from '../../../shared/auth/permissions'
import { invitationStatusSchema } from '../../../shared/schemas/members'
import type { InvitationCreateInput, PendingInvitation } from '../../../shared/schemas/members'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { InvalidStateError, NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { OrganizationAuthGateway } from './OrganizationAuthGateway'

/** An invitation row of the scoped organization, with the inviter's name. */
interface InvitationRecord {
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  createdAt: Date
  inviterName: string | null
  inviterEmail: string | null
}

/** Unknown stored states read as canceled (never actionable). */
const statusSchema = invitationStatusSchema.catch('canceled')

const uuidSchema = z.uuid()

const inviter = alias(user, 'inviter')

const INVITATION_COLUMNS = {
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
  inviterName: inviter.name,
  inviterEmail: inviter.email
} as const

/** Link an invitee opens to accept an invitation. */
export function invitationUrl(baseUrl: string, invitationId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/invitations/${invitationId}`
}

/**
 * Invitations of one organization: list, invite, re-send and cancel. Reads are
 * scoped by the TenantScope; changes go through Better Auth with the signed-in
 * user's headers (permission, owner and already-a-member rules, the invitation
 * email and the audit entries of its organization hooks).
 */
export class InvitationService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly audit: AuditLogger,
    private readonly baseUrl: string
  ) {}

  /** Pending invitations, newest first (expired ones are flagged, not hidden). */
  async list(): Promise<PendingInvitation[]> {
    const rows = await this.db
      .select(INVITATION_COLUMNS)
      .from(invitation)
      .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
      .where(and(this.scope.eq(invitation.organizationId), eq(invitation.status, 'pending')))
      .orderBy(desc(invitation.createdAt))

    return rows.map((row) => this.toPending(row))
  }

  /** An invitation of this organization; ids of other organizations are not found. */
  async findOrFail(invitationId: string): Promise<InvitationRecord> {
    const [row] = uuidSchema.safeParse(invitationId).success
      ? await this.db
          .select(INVITATION_COLUMNS)
          .from(invitation)
          .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
          .where(and(this.scope.eq(invitation.organizationId), eq(invitation.id, invitationId)))
      : []

    if (!row) throw new NotFoundError('Invitation', invitationId)

    return row
  }

  /** Invites `email` with `role`; a pending invitation of the same email is replaced. */
  async invite(
    input: InvitationCreateInput,
    gateway: OrganizationAuthGateway
  ): Promise<PendingInvitation> {
    const created = await gateway.invite(this.scope.organizationId, input.email, input.role)

    return this.toPending(await this.findOrFail(created.id))
  }

  /**
   * Sends the invitation email again and renews its expiry. An expired
   * invitation is replaced by a new one (Better Auth only renews live ones).
   */
  async resend(
    invitationId: string,
    actor: Actor,
    gateway: OrganizationAuthGateway
  ): Promise<PendingInvitation> {
    const current = await this.findOrFail(invitationId)

    if (current.status !== 'pending')
      throw new InvalidStateError(`This invitation was already ${current.status}.`)

    const renewed = await gateway.invite(
      this.scope.organizationId,
      current.email,
      current.role ?? 'member',
      true
    )

    if (renewed.id !== current.id) {
      // A new invitation replaced the expired one (audited by the creation hook).
      await this.supersede(current.id)

      return this.toPending(await this.findOrFail(renewed.id))
    }

    await this.audit.log(actor, {
      action: 'invitation.resent',
      entityType: 'invitation',
      entityId: current.id,
      summary: `Re-sent the invitation of ${current.email} as ${roleLabel(current.role)}`,
      changes: { email: current.email, role: current.role, expiresAt: renewed.expiresAt }
    })

    return this.toPending(await this.findOrFail(current.id))
  }

  /** Cancels a pending invitation of this organization. */
  async cancel(invitationId: string, gateway: OrganizationAuthGateway): Promise<void> {
    const current = await this.findOrFail(invitationId)

    if (current.status !== 'pending')
      throw new InvalidStateError(`This invitation was already ${current.status}.`)

    await gateway.cancelInvitation(current.id)
  }

  /** Marks an expired invitation as canceled once a new one replaced it. */
  private async supersede(invitationId: string): Promise<void> {
    await this.db
      .update(invitation)
      .set({ status: 'canceled' })
      .where(and(this.scope.eq(invitation.organizationId), eq(invitation.id, invitationId)))
  }

  private toPending(row: InvitationRecord): PendingInvitation {
    return {
      id: row.id,
      email: row.email,
      role: row.role ?? 'member',
      status: statusSchema.parse(row.status),
      invitedBy: row.inviterName || row.inviterEmail,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      expired: row.expiresAt.getTime() <= Date.now(),
      url: invitationUrl(this.baseUrl, row.id)
    }
  }
}
